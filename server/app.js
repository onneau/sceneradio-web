// De HTTP-server: de pagina's, de API voor luisteren en de beveiligde API voor beheren.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Store } from './store.js';
import { Auth } from './auth.js';
import { Users, AccountError, generatePassword } from './users.js';
import { Library } from './library.js';
import { GitHubError } from './github.js';
import { proxyStream } from './streams.js';
import { UpdateChecker } from './updates.js';
import { CoverService, BusyError } from './covers.js';
import { RateLimiter } from './ratelimit.js';
import { tr, langOf, runWithLang } from './i18n.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const MAX_BODY = 8 * 1024 * 1024;
const MAX_LOGIN_BODY = 4 * 1024; // het inlogverzoek mag iedereen sturen, dus klein houden

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

async function readJsonBody(req, maxBytes = MAX_BODY) {
  const type = String(req.headers['content-type'] || '');
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, tr('Verwacht JSON.', 'Expected JSON.'));
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, tr('Het verzoek is te groot.', 'The request is too large.'));
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('geen object');
    return value;
  } catch {
    throw new HttpError(400, tr('Ongeldige JSON.', 'Invalid JSON.'));
  }
}

/**
 * Het adres van de bezoeker, voor de inlogbeveiliging. X-Forwarded-For wordt alleen geloofd als TRUST_PROXY aanstaat
 * (de container staat dan achter een reverse proxy die de header zelf zet): anders kan iedereen met een eigen header
 * de begrenzing omzeilen. Het laatste adres in de lijst is dat wat de dichtstbijzijnde proxy heeft gezien.
 */
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || '';
}

function isSecure(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || Boolean(req.socket.encrypted);
}


export function createApp(config, { fetchBytes } = {}) {
  const store = new Store(config.dataDir);
  const users = new Users(config.dataDir);
  const auth = new Auth(config, users);
  const profileLimit = new RateLimiter(120, 60 * 1000); // opslaan van het profiel, per account
  const library = new Library(config, store);
  const updates = new UpdateChecker(config);

  const covers = config.covers
    ? new CoverService({ dir: config.dataDir, userAgent: config.userAgent, deezer: config.coversDeezer, gapMs: config.coversGapMs, fetchBytes })
    : null;
  const coverLimit = new RateLimiter(config.coversRatePerMinute, 60 * 1000);

  const nowPlaying = new Map(); // id -> { title, at }
  const listeners = new Set();

  const publicStation = (s) => ({
    id: s.id,
    name: s.name,
    genres: s.genres,
    logo: s.logo.kind === 'none' ? null : { v: s.logo.v },
    source: s.source,
    pending: s.pending
  });

  /** Met inloggen mogen logo's en hoezen alleen in de browser van de bezoeker blijven, niet in een gedeelde cache (reverse proxy). */
  const scope = () => (auth.enabled ? 'private' : 'public');

  /** Het account achter het verzoek, mits dat de beheerder is. */
  function requireAdmin(req) {
    if (!auth.enabled) throw new HttpError(403, tr('Inloggen staat uit: stel ADMIN_PASSWORD in.', 'Logging in is off: set ADMIN_PASSWORD.'));
    const session = auth.sessionOf(req);
    if (!session) throw new HttpError(401, tr('Log eerst in.', 'Log in first.'));
    if (session.role !== 'admin') throw new HttpError(403, tr('Dit mag alleen de beheerder.', 'Only the administrator may do this.'));
    return session;
  }


  async function ensureLibrary() {
    await library.refresh().catch(() => {});
    if (!library.loadedOnce) throw new HttpError(503, library.lastError || tr('De zenderlijst kon niet worden opgehaald.', 'The station list could not be fetched.'));
  }

  // ------------------------------------------------------------------ routes

  async function route(req, res, url) {
    const method = req.method;
    const p = url.pathname;
    let m;

    // Is inloggen aan (ADMIN_PASSWORD), dan kan niemand iets zonder account, behalve inloggen zelf en vragen of dat nodig is.
    const session = auth.enabled ? auth.sessionOf(req) : null;
    const open = (method === 'GET' && p === '/api/config') || (method === 'POST' && (p === '/api/login' || p === '/api/logout'));
    if (auth.enabled && !session && !open) throw new HttpError(401, tr('Log eerst in.', 'Log in first.'));

    if (method === 'GET' && p === '/api/config') {
      if (auth.enabled && !session) return sendJson(res, 200, { loginRequired: true, user: null });
      return sendJson(res, 200, {
        version: config.version,
        repo: `${config.owner}/${config.repo}`,
        loginRequired: auth.enabled,
        user: session ? { name: session.name, role: session.role } : null,
        covers: Boolean(covers),
        deezer: Boolean(covers) && config.coversDeezer
      });
    }

    // Is er een nieuwere versie van de webapp? (alleen versienummers en de changelog, niets gevoeligs)
    if (method === 'GET' && p === '/api/update') return sendJson(res, 200, await updates.get());
    if (method === 'POST' && p === '/api/update/check') {
      await readJsonBody(req);
      return sendJson(res, 200, await updates.get({ force: true }));
    }

    if (method === 'GET' && p === '/api/stations') {
      await ensureLibrary();
      const all = false;
      const stations = library.list({ includeHidden: all });
      return sendJson(res, 200, {
        updatedAt: library.fetchedAt ? new Date(library.fetchedAt).toISOString() : null,
        error: library.lastError,
        stations: stations.map(publicStation)
      });
    }

    if (method === 'GET' && (m = p.match(/^\/api\/logo\/([a-z0-9-]+)$/))) {
      await ensureLibrary();
      const station = library.find(m[1]);
      if (!station || station.logo.kind === 'none') throw new HttpError(404, tr('Geen logo.', 'No logo.'));
      const bytes = await library.logoBytes(station);
      if (!bytes) throw new HttpError(404, tr('Geen logo.', 'No logo.'));
      const versioned = url.searchParams.has('v') && url.searchParams.get('v') !== '';
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': bytes.length,
        'Cache-Control': versioned ? `${scope()}, max-age=31536000, immutable` : `${scope()}, max-age=3600`
      });
      return res.end(bytes);
    }

    if (method === 'GET' && (m = p.match(/^\/api\/stream\/([a-z0-9-]+)$/))) {
      await ensureLibrary();
      const station = library.find(m[1]);
      if (!station || station.hidden) throw new HttpError(404, tr('Onbekende zender.', 'Unknown station.'));
      if (listeners.size >= config.maxListeners) throw new HttpError(503, tr('Er luisteren al te veel mensen mee.', 'Too many people are listening already.'));
      const handle = {};
      listeners.add(handle);
      nowPlaying.delete(station.id);
      return proxyStream(req, res, station.url, {
        allowPrivate: config.allowPrivateStreams,
        onTitle: (title) => nowPlaying.set(station.id, { title, at: Date.now() }),
        onClose: () => listeners.delete(handle)
      });
    }

    if (method === 'GET' && (m = p.match(/^\/api\/nowplaying\/([a-z0-9-]+)$/))) {
      const entry = nowPlaying.get(m[1]);
      return sendJson(res, 200, { title: entry ? entry.title : null });
    }

    // De hoes bij een nummer, of (photo=1) een foto van de artiest als er geen hoes is. De server zoekt het op; de
    // bezoeker stuurt alleen artiest en titel. Per bezoeker begrensd, zodat niemand dit als zoekmachine kan gebruiken.
    if (method === 'GET' && p === '/api/art') {
      if (!covers) throw new HttpError(404, tr('Hoezen staan uit.', 'Covers are off.'));
      if (!coverLimit.take(clientIp(req, config.trustProxy))) throw new HttpError(429, tr('Te veel verzoeken om hoezen. Probeer het zo meteen opnieuw.', 'Too many cover requests. Try again in a moment.'));
      const artist = (url.searchParams.get('artist') || '').slice(0, 150);
      const title = (url.searchParams.get('title') || '').slice(0, 150);
      let hit;
      try {
        hit = await covers.find(artist, title, url.searchParams.get('photo') === '1');
      } catch (error) {
        if (error instanceof BusyError) throw new HttpError(503, tr('Er worden nu te veel hoezen opgezocht.', 'Too many covers are being looked up right now.'));
        throw error;
      }
      if (!hit) return sendJson(res, 404, { error: tr('Geen hoes gevonden.', 'No cover found.') }, { 'Cache-Control': `${scope()}, max-age=600` });
      res.writeHead(200, {
        'Content-Type': hit.type,
        'Content-Length': hit.bytes.length,
        'Cache-Control': `${scope()}, max-age=86400`,
        'X-Art-Kind': hit.kind
      });
      return res.end(hit.bytes);
    }

    if (method === 'POST' && p === '/api/login') return login(req, res);

    if (method === 'POST' && p === '/api/logout') {
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie(isSecure(req)) });
    }

    if (p === '/api/me' || p.startsWith('/api/me/')) return meRoute(req, res, method, p, session);
    if (p === '/api/users' || p.startsWith('/api/users/')) {
      requireAdmin(req);
      return usersRoute(req, res, method, p);
    }


    throw new HttpError(404, tr('Niet gevonden.', 'Not found.'));
  }

  // ------------------------------------------------------------------ inloggen en accounts

  async function login(req, res) {
    if (!auth.enabled) throw new HttpError(403, tr('Inloggen staat uit: stel ADMIN_PASSWORD in.', 'Logging in is off: set ADMIN_PASSWORD.'));
    const ip = clientIp(req, config.trustProxy);
    const body = await readJsonBody(req, MAX_LOGIN_BODY);
    const name = Auth.cleanName(body.name); // zonder naam: de beheerder (zo werkte inloggen voor de komst van accounts)
    if (auth.limited(ip, name)) throw new HttpError(429, tr('Te vaak een fout wachtwoord. Probeer het over enkele minuten opnieuw.', 'Too many wrong passwords. Try again in a few minutes.'));
    // De poging telt meteen mee, nog voor de (trage) controle: honderd gelijktijdige pogingen komen er zo niet allemaal langs.
    auth.fail(ip, name);
    const result = await auth.authenticate(name, body.password);
    if (result.error === 'disabled') throw new HttpError(403, tr('Dit account is uitgeschakeld. Vraag de beheerder.', 'This account is disabled. Ask the administrator.'));
    if (!result.session) throw new HttpError(401, tr('Gebruikersnaam of wachtwoord klopt niet.', 'Username or password is not correct.'));
    auth.succeed(ip, name); // goed: de tellers van dit adres en deze naam beginnen opnieuw
    users.touchLogin(result.session.uid);
    const remember = body.remember !== false;
    return sendJson(res, 200, { ok: true, user: { name: result.session.name, role: result.session.role } },
      { 'Set-Cookie': auth.setCookie(auth.makeToken(result.session, { remember }), { remember }, isSecure(req)) });
  }

  /** Het eigen account: profiel (favorieten en instellingen), wachtwoord en overal uitloggen. */
  async function meRoute(req, res, method, p, session) {
    if (!session) throw new HttpError(403, tr('Inloggen staat uit: stel ADMIN_PASSWORD in.', 'Logging in is off: set ADMIN_PASSWORD.'));
    if (method === 'GET' && p === '/api/me') {
      return sendJson(res, 200, { user: { name: session.name, role: session.role }, profile: users.getProfile(session.uid) });
    }
    if (method === 'POST' && p === '/api/me/profile') {
      if (!profileLimit.take(session.uid)) throw new HttpError(429, tr('Te vaak opgeslagen. Probeer het zo meteen opnieuw.', 'Saved too often. Try again in a moment.'));
      const body = await readJsonBody(req);
      return sendJson(res, 200, { ok: true, updatedAt: users.saveProfile(session.uid, body.backup) });
    }
    if (method === 'POST' && p === '/api/me/password') {
      if (session.role === 'admin') throw new HttpError(400, tr('Het wachtwoord van de beheerder stel je in met ADMIN_PASSWORD.', 'The administrator password is set with ADMIN_PASSWORD.'));
      const ip = clientIp(req, config.trustProxy);
      const body = await readJsonBody(req, MAX_LOGIN_BODY);
      if (auth.limited(ip, session.name)) throw new HttpError(429, tr('Te vaak een fout wachtwoord. Probeer het over enkele minuten opnieuw.', 'Too many wrong passwords. Try again in a few minutes.'));
      auth.fail(ip, session.name); // zoals bij inloggen: de poging telt meteen
      const { user } = await users.check(session.name, String(body.current ?? ''));
      if (!user) throw new HttpError(403, tr('Je huidige wachtwoord klopt niet.', 'Your current password is not correct.'));
      auth.succeed(ip, session.name);
      await users.setPassword(user.id, body.next);
      // Alle andere apparaten zijn nu uitgelogd; dit apparaat krijgt meteen een nieuwe cookie.
      const remember = auth.isRemembered(req);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.setCookie(auth.makeToken(session, { remember }), { remember }, isSecure(req)) });
    }
    if (method === 'POST' && p === '/api/me/logout-all') {
      users.logoutAll(session.uid);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie(isSecure(req)) });
    }
    throw new HttpError(404, tr('Niet gevonden.', 'Not found.'));
  }

  /** De gebruikers beheren: alleen voor de beheerder (requireAdmin is al gecontroleerd). */
  async function usersRoute(req, res, method, p) {
    let m;
    if (method === 'GET' && p === '/api/users') return sendJson(res, 200, { users: users.list() });
    if (method === 'POST' && p === '/api/users') {
      const body = await readJsonBody(req, MAX_LOGIN_BODY);
      const given = typeof body.password === 'string' && body.password !== '' ? body.password : null;
      const password = given ?? generatePassword();
      const user = await users.create(body.name, password);
      return sendJson(res, 200, { ok: true, user, ...(given === null ? { password } : {}) }); // een gekozen wachtwoord sturen we niet terug
    }
    if (method === 'POST' && (m = p.match(/^\/api\/users\/(u[0-9a-f]{12})\/(password|disabled|delete)$/))) {
      const [, id, action] = m;
      const body = await readJsonBody(req, MAX_LOGIN_BODY);
      if (action === 'password') {
        const given = typeof body.password === 'string' && body.password !== '' ? body.password : null;
        const password = given ?? generatePassword();
        await users.setPassword(id, password);
        return sendJson(res, 200, { ok: true, ...(given === null ? { password } : {}) });
      }
      if (action === 'disabled') return sendJson(res, 200, { ok: true, user: users.setDisabled(id, body.disabled === true) });
      users.remove(id);
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(404, tr('Niet gevonden.', 'Not found.'));
  }


  // ------------------------------------------------------------------ bestanden

  async function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const full = path.resolve(config.publicDir, '.' + path.posix.normalize('/' + rel));
    if (!full.startsWith(path.resolve(config.publicDir) + path.sep)) throw new HttpError(404, tr('Niet gevonden.', 'Not found.'));
    let info;
    try {
      info = await stat(full);
      if (info.isDirectory()) throw new Error('map');
    } catch {
      throw new HttpError(404, tr('Niet gevonden.', 'Not found.'));
    }
    const ext = path.extname(full).toLowerCase();
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const longLived = ext === '.png' || ext === '.jpg' || ext === '.svg' || ext === '.ico';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ETag: etag,
      'Cache-Control': longLived ? 'public, max-age=86400' : 'no-cache'
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    const data = await readFile(full);
    res.writeHead(200, { ...headers, 'Content-Length': data.length });
    return res.end(req.method === 'HEAD' ? undefined : data);
  }

  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
  };

  const handle = async (req, res) => {
    for (const [key, value] of Object.entries(securityHeaders)) res.setHeader(key, value);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (!['GET', 'POST'].includes(req.method)) throw new HttpError(405, tr('Methode niet toegestaan.', 'Method not allowed.'));
        return await route(req, res, url);
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, tr('Methode niet toegestaan.', 'Method not allowed.'));
      return await serveStatic(req, res, url);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return undefined;
      }
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
      if (error instanceof AccountError) return sendJson(res, error.status, { error: tr(error.nl, error.en) });
      if (error instanceof GitHubError) return sendJson(res, 502, { error: error.message });
      console.error('[sceneradio-web] onverwachte fout:', error);
      return sendJson(res, 500, { error: tr('Er ging iets mis op de server.', 'Something went wrong on the server.') });
    }
  };
  const server = http.createServer((req, res) => runWithLang(langOf(req), () => handle(req, res)));
  server.requestTimeout = 0; // luisterstreams duren uren
  server.headersTimeout = 20000;

  // Alvast ophalen, zodat de eerste bezoeker niet hoeft te wachten.
  const warmUp = () => library.refresh().catch((error) => console.warn('[sceneradio-web] playlist ophalen mislukt:', error.message));

  return { server, store, auth, users, library, listeners, warmUp, covers };
}
