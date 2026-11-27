// Hulpmiddelen voor de tests: een nep-GitHub (met dezelfde API-stappen als de echte), een nep-radiostream
// met ICY-metadata en een manier om de app op een willekeurige poort te starten.
import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixture = (name) => readFileSync(path.join(here, 'fixtures', name));
export const fixtureText = (name) => fixture(name).toString('utf8');

export const TOKENS = { read: 'read-token', admin: 'admin-token' };

export function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

export function close(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

/** Een GitHub in het klein: bestanden, commits, trees, blobs, de branch en de workflow. */
export class FakeGitHub {
  constructor(files = {}) {
    this.snapshots = new Map(); // commit/tree-id -> Map(path -> Buffer)
    this.blobs = new Map();
    this.trees = new Map();
    this.commits = new Map();
    this.counter = 0;
    this.requests = [];
    this.dispatches = 0;
    this.failNextPatch = 0; // zoveel keer 422 geven bij het verplaatsen van de branch
    this.release = null; // antwoord van releases/latest (null = 404)
    this.runs = [{ id: 7, status: 'completed', conclusion: 'success', created_at: '2026-11-01T04:00:12Z', html_url: 'https://github.com/o/r/actions/runs/7' }];
    const initial = new Map(Object.entries(files).map(([name, data]) => [name, Buffer.from(data)]));
    this.head = this.newCommit(initial, null, 'start');
  }

  newCommit(snapshot, parent, message) {
    const sha = `c${++this.counter}`;
    this.commits.set(sha, { snapshot, parent, message, tree: `t-${sha}` });
    this.snapshots.set(sha, snapshot);
    this.trees.set(`t-${sha}`, snapshot);
    return sha;
  }

  /** De bestanden op dit moment (HEAD). */
  get files() {
    return this.commits.get(this.head).snapshot;
  }

  text(filePath) {
    return this.files.get(filePath)?.toString('utf8') ?? null;
  }

  /** Simuleert de dagelijkse run: nieuwe bestanden rechtstreeks op de branch. */
  setFiles(update) {
    const snapshot = new Map(this.files);
    for (const [name, data] of Object.entries(update)) snapshot.set(name, Buffer.from(data));
    this.head = this.newCommit(snapshot, this.head, 'generator');
  }

  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.port = await listen(this.server);
    this.url = `http://127.0.0.1:${this.port}`;
    return this;
  }

  stop() {
    return close(this.server);
  }

  reply(res, status, body, type = 'application/json') {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': data.length });
    res.end(data);
  }

  async handle(req, res) {
    const url = new URL(req.url, this.url);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    this.requests.push({ method: req.method, path: url.pathname, query: url.search, auth: req.headers.authorization || '', body });

    // Publieke raw-URL: /<owner>/<repo>/<ref>/<pad>
    let m = url.pathname.match(/^\/(?:onneau|o)\/(?:etherwave-M3U|sceneradio-m3u|r)\/main\/(.+)$/);
    if (!url.pathname.startsWith('/repos/') && m) {
      const data = this.files.get(decodeURIComponent(m[1]));
      return data ? this.reply(res, 200, data, 'application/octet-stream') : this.reply(res, 404, { message: 'Not Found' });
    }

    if (this.rejectAll) return this.reply(res, 401, { message: 'Bad credentials' });
    const p = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+\//, '');
    if (req.method === 'GET' && (m = p.match(/^contents\/(.+)$/))) {
      const ref = url.searchParams.get('ref') || 'main';
      const snapshot = this.snapshots.get(ref === 'main' ? this.head : ref);
      const data = snapshot?.get(decodeURIComponent(m[1]));
      return data ? this.reply(res, 200, data, 'application/vnd.github.raw+json') : this.reply(res, 404, { message: 'Not Found' });
    }
    if (req.method === 'GET' && p === 'git/ref/heads/main') return this.reply(res, 200, { object: { sha: this.head } });
    if (req.method === 'GET' && (m = p.match(/^git\/commits\/(.+)$/))) {
      const commit = this.commits.get(m[1]);
      return commit ? this.reply(res, 200, { tree: { sha: commit.tree } }) : this.reply(res, 404, { message: 'Not Found' });
    }
    if (req.method === 'POST' && p === 'git/blobs') {
      const sha = `b${++this.counter}`;
      this.blobs.set(sha, Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8'));
      return this.reply(res, 201, { sha });
    }
    if (req.method === 'POST' && p === 'git/trees') {
      const snapshot = new Map(this.trees.get(body.base_tree));
      for (const entry of body.tree) {
        snapshot.set(entry.path, entry.sha ? this.blobs.get(entry.sha) : Buffer.from(entry.content, 'utf8'));
      }
      const sha = `t${++this.counter}`;
      this.trees.set(sha, snapshot);
      return this.reply(res, 201, { sha });
    }
    if (req.method === 'POST' && p === 'git/commits') {
      const sha = `c${++this.counter}`;
      this.commits.set(sha, { snapshot: this.trees.get(body.tree), parent: body.parents[0], message: body.message, tree: body.tree });
      this.snapshots.set(sha, this.trees.get(body.tree));
      return this.reply(res, 201, { sha });
    }
    if (req.method === 'PATCH' && p === 'git/refs/heads/main') {
      const commit = this.commits.get(body.sha);
      if (this.failNextPatch > 0) {
        this.failNextPatch--;
        // iemand anders was ons voor
        this.setFiles({ 'other.txt': 'x' });
        return this.reply(res, 422, { message: 'Update is not a fast forward' });
      }
      if (!commit || commit.parent !== this.head) return this.reply(res, 422, { message: 'Update is not a fast forward' });
      this.head = body.sha;
      return this.reply(res, 200, { object: { sha: body.sha } });
    }
    if (req.method === 'POST' && p === 'actions/workflows/main.yml/dispatches') {
      this.dispatches++;
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'GET' && p === 'releases/latest') {
      return this.release ? this.reply(res, 200, this.release) : this.reply(res, 404, { message: 'Not Found' });
    }
    if (req.method === 'GET' && p === 'actions/workflows/main.yml/runs') return this.reply(res, 200, { workflow_runs: this.runs });
    return this.reply(res, 404, { message: 'Not Found' });
  }
}

/** Een radiozender: stuurt audio (nepbytes) met ICY-metadata, of antwoordt met een fout. */
export class FakeRadio {
  constructor() {
    this.hits = [];
  }

  static meta(title) {
    const text = `StreamTitle='${title}';`;
    const padded = Buffer.alloc(Math.ceil(text.length / 16) * 16);
    padded.write(text);
    return Buffer.concat([Buffer.from([padded.length / 16]), padded]);
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this.hits.push({ path: req.url, range: req.headers.range, icy: req.headers['icy-metadata'] });
      if (req.url === '/ok') {
        res.writeHead(206, { 'Content-Type': 'audio/mpeg' });
        return res.end('ab');
      }
      if (req.url === '/notfound') {
        res.writeHead(404);
        return res.end('nee');
      }
      if (req.url === '/html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html></html>');
      }
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/ok' });
        return res.end();
      }
      if (req.url === '/hang') return undefined;
      if (req.url === '/icy') {
        const metaint = 16;
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-metaint': String(metaint), 'icy-name': 'Test' });
        // 3 blokken van 16 bytes audio, met metadata ertussen (eerst een lege, dan een titel, dan een nieuwe)
        const audio = (n) => Buffer.alloc(metaint, 0x61 + n);
        const parts = [audio(0), Buffer.from([0]), audio(1), FakeRadio.meta('Daft Punk - One More Time'), audio(2), FakeRadio.meta('Artiest - Nieuw nummer')];
        const all = Buffer.concat(parts);
        // In kleine stukjes, zodat de metadata over stukgrenzen heen valt
        let at = 0;
        const timer = setInterval(() => {
          if (at >= all.length) {
            clearInterval(timer);
            return res.end();
          }
          res.write(all.subarray(at, at + 7));
          at += 7;
        }, 2);
        res.on('close', () => clearInterval(timer));
        return undefined;
      }
      if (req.url === '/plain') {
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        return res.end(Buffer.alloc(1000, 0x62));
      }
      if (req.url === '/logo.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(Buffer.from('89504e470d0a1a0a', 'hex'));
      }
      res.writeHead(404);
      return res.end();
    });
    this.port = await listen(this.server);
    this.url = `http://127.0.0.1:${this.port}`;
    return this;
  }

  stop() {
    return close(this.server);
  }
}

/** Start de hele app met een nep-GitHub; geeft alles terug wat de tests nodig hebben. */
export async function startApp({ github, env = {}, fetchBytes } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'etherwave-test-'));
  const config = loadConfig({
    PORT: '0',
    DATA_DIR: dataDir,
    GITHUB_API_URL: github.url,
    GITHUB_RAW_URL: github.url,
    GITHUB_READ_TOKEN: TOKENS.read,
    GITHUB_ADMIN_TOKEN: TOKENS.admin,
    ADMIN_PASSWORD: 'geheim',
    ALLOW_PRIVATE_STREAMS: '1',
    PLAYLIST_TTL_SECONDS: '10',
    CHECK_RETRY_DELAY_MS: '10',
    ...env
  });
  const app = createApp(config, { fetchBytes });
  const port = await listen(app.server);
  const base = `http://127.0.0.1:${port}`;
  // Is inloggen aan (ADMIN_PASSWORD), dan logt de testhulp zelf in als beheerder, tenzij een test een eigen cookie meegeeft
  // (cookie: '...') of zonder inlog wil vragen (anonymous: true).
  let autoCookie = null;
  const adminCookie = async () => {
    if (!autoCookie) {
      const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: config.adminPassword }) });
      autoCookie = (r.headers.get('set-cookie') || '').split(';')[0];
    }
    return autoCookie;
  };
  const request = async (method, url, { body, cookie, headers = {}, anonymous = false } = {}) => {
    let session = cookie;
    if (session === undefined && !anonymous && config.adminPassword && !['/api/login', '/api/logout'].includes(url)) session = await adminCookie();
    const response = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Cookie: session } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    let json = null;
    if ((response.headers.get('content-type') || '').includes('json')) json = JSON.parse(buffer.toString('utf8'));
    return { status: response.status, headers: response.headers, buffer, json };
  };
  const login = async () => {
    const r = await request('POST', '/api/login', { body: { password: 'geheim' } });
    return r.headers.get('set-cookie').split(';')[0];
  };
  return {
    app, config, dataDir, base, request, login,
    stop: () => close(app.server)
  };
}

/** Een kleine M3U met nep-zenders, in dezelfde vorm als de generator hem schrijft. */
export function m3u(entries) {
  const lines = ['#EXTM3U'];
  for (const e of entries) {
    lines.push(`#EXTINF:-1 tvg-name="${e.name}" tvg-logo="${e.logo ?? ''}" group-title="${e.group ?? 'Algemeen'}",${e.name}`);
    lines.push(e.url);
  }
  return lines.join('\n') + '\n';
}
