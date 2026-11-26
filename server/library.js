// De zenderlijst van de webapp: de M3U uit de repository, aangevuld met wat je hier zelf toevoegt of verbergt.
import { parseM3u, splitGenres, parseLogoRef } from './m3u.js';
import { slugify } from './repofiles.js';
import { GitHubRepo, GitHubError } from './github.js';
import { httpGet, readLimited } from './net.js';
import { both, pick } from './i18n.js';

const DEAD_AFTER = 3; // een zender valt na zoveel opeenvolgende fouten uit de M3U (DEAD_AFTER in check_streams.py)
const LOGO_CACHE_MAX = 400;
const MAX_EXTERNAL_LOGO = 4 * 1024 * 1024;

/** Samenvatting van stream-status.json: de uitkomst van de laatste dagelijkse controle op GitHub. */
export function parseRepoStreamStatus(json) {
  let root;
  try {
    root = JSON.parse(json);
  } catch {
    return null;
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return null;
  let checkedOn = '';
  let working = 0;
  let failing = 0;
  let excluded = 0;
  for (const info of Object.values(root)) {
    if (info === null || typeof info !== 'object') continue;
    const fails = Number.isFinite(info.fails) ? info.fails : 0;
    const day = typeof info.last_checked === 'string' ? info.last_checked : '';
    if (day > checkedOn) checkedOn = day;
    if (fails <= 0) {
      working++;
    } else {
      failing++;
      if (fails >= DEAD_AFTER) excluded++;
    }
  }
  if (checkedOn === '' && working + failing === 0) return null;
  return { checkedOn, working, failing, excluded };
}

export class Library {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    // Eén token om te lezen (zonder token: de publieke raw-URL).
    this.reader = new GitHubRepo(config, config.readToken);
    this.repoStations = [];
    this.fetchedAt = 0;
    this.loadedOnce = false;
    this.error = null; // { nl, en } of null; zo kan elke bezoeker de melding in zijn eigen taal lezen
    this.loading = null;
    this.logoCache = new Map();
    this.statusCache = { at: 0, value: null };
  }

  /** De laatste fout in de taal van het lopende verzoek ('' als alles goed ging). */
  get lastError() {
    return this.error ? pick(this.error) : '';
  }

  set lastError(value) {
    this.error = value ? (typeof value === 'object' ? value : both(String(value), String(value))) : null;
  }

  // ---------------------------------------------------------------- bestanden uit de repository

  rawUrl(filePath) {
    const { rawUrl, owner, repo, ref } = this.config;
    return `${rawUrl}/${owner}/${repo}/${ref}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  }

  async repoText(filePath) {
    if (this.reader.hasToken) return this.reader.readText(filePath);
    const response = await fetch(this.rawUrl(filePath), { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'SceneRadioWeb/1.0' } });
    if (response.status === 404) return null;
    if (!response.ok) throw new GitHubError(both(`GitHub-fout ${response.status}`, `GitHub error ${response.status}`), response.status);
    return response.text();
  }

  async repoBytes(filePath) {
    if (this.reader.hasToken) return this.reader.readBytes(filePath);
    const response = await fetch(this.rawUrl(filePath), { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'SceneRadioWeb/1.0' } });
    if (response.status === 404) return null;
    if (!response.ok) throw new GitHubError(both(`GitHub-fout ${response.status}`, `GitHub error ${response.status}`), response.status);
    return Buffer.from(await response.arrayBuffer());
  }

  // ---------------------------------------------------------------- de playlist

  /** Haalt de M3U op als die verouderd is (of `force`). Bij een fout blijft de laatste goede lijst staan. */
  async refresh({ force = false } = {}) {
    const fresh = Date.now() - this.fetchedAt < this.config.playlistTtlMs;
    if (!force && this.loadedOnce && fresh) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const text = await this.repoText(this.config.playlistPath);
        if (text === null) {
          const hint = this.reader.hasToken
            ? both('Controleer GITHUB_OWNER, GITHUB_REPO en of het token bij die repository hoort.', 'Check GITHUB_OWNER, GITHUB_REPO and whether the token belongs to that repository.')
            : both('Is de repository privé? Stel dan GITHUB_READ_TOKEN in.', 'Is the repository private? Then set GITHUB_READ_TOKEN.');
          const where = `${this.config.owner}/${this.config.repo}`;
          throw new GitHubError(both(`${this.config.playlistPath} staat niet in ${where}. ${hint.nl}`, `${this.config.playlistPath} is not in ${where}. ${hint.en}`));
        }
        const parsed = parseM3u(text);
        if (parsed.length === 0) throw new GitHubError(both('De playlist bevat geen zenders.', 'The playlist contains no stations.'));
        this.repoStations = parsed;
        this.fetchedAt = Date.now();
        this.loadedOnce = true;
        this.lastError = '';
        this.reconcile();
      } catch (error) {
        this.lastError = error?.texts || both(error?.message || 'Onbekende fout', error?.message || 'Unknown error');
        // Opnieuw proberen na een korte tijd, niet bij elk verzoek.
        this.fetchedAt = Date.now() - this.config.playlistTtlMs + 30000;
        if (!this.loadedOnce) throw error;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** Verwijdert lokale wijzigingen die "naar GitHub" gingen zodra de gegenereerde playlist ze bevat. */
  reconcile() {
    const byName = new Map(this.repoStations.map((s) => [s.name, s]));
    for (const entry of [...this.store.localStations]) {
      if (!entry.pending) continue;
      const repo = byName.get(entry.name);
      if (repo && repo.url === entry.url && (repo.group ?? 'Algemeen') === entry.group) this.store.removeStation(entry.name);
    }
    for (const [slug, meta] of Object.entries(this.store.logoMeta)) {
      if (!meta.pending) continue;
      const repo = this.repoStations.find((s) => slugify(s.name) === slug);
      const ref = repo ? parseLogoRef(repo.logo) : null;
      if (ref?.path && ref.version === meta.hash) this.store.removeLogo(slug);
    }
  }

  /** De samengevoegde lijst, in de volgorde van de M3U, met eigen zenders erachter. */
  list({ includeHidden = false } = {}) {
    const result = [];
    const seen = new Set();
    const locals = new Map(this.store.localStations.map((s) => [s.name, s]));

    const build = (base, source, local) => {
      const id = slugify(base.name);
      if (seen.has(id)) return;
      seen.add(id);
      const meta = this.store.logoMeta[id];
      const hasLocalLogo = this.store.hasLogo(id);
      const ref = parseLogoRef(base.logo);
      let logo = { kind: 'none', v: '' };
      if (hasLocalLogo) logo = { kind: 'local', v: meta?.hash || 'x' };
      else if (ref?.path) logo = { kind: 'repo', v: ref.version };
      else if (ref?.url) logo = { kind: 'external', v: '' };
      const hidden = this.store.hidden.has(base.name);
      if (hidden && !includeHidden) return;
      const group = base.group ?? 'Algemeen';
      result.push({
        id,
        name: base.name,
        url: base.url,
        group,
        genres: splitGenres(group),
        logo,
        source,
        hidden,
        pending: Boolean(local?.pending),
        edited: source === 'repo' && Boolean(local) && !local.pending
      });
    };

    for (const station of this.repoStations) {
      const local = locals.get(station.name);
      build(local ? { ...station, url: local.url, group: local.group } : station, 'repo', local);
    }
    for (const local of this.store.localStations) {
      // Een zender die naar GitHub is gezet maar nog niet in de gegenereerde playlist staat, hoort al bij de repository.
      if (!this.repoStations.some((s) => s.name === local.name)) build(local, local.pending ? 'repo' : 'lokaal', local);
    }
    return result;
  }

  find(id) {
    return this.list({ includeHidden: true }).find((s) => s.id === id) ?? null;
  }

  findByName(name) {
    return this.list({ includeHidden: true }).find((s) => s.name === name) ?? null;
  }

  // ---------------------------------------------------------------- logo's

  remember(key, value) {
    this.logoCache.set(key, value);
    if (this.logoCache.size > LOGO_CACHE_MAX) this.logoCache.delete(this.logoCache.keys().next().value);
  }

  /** De bytes van het logo van een zender, of null. */
  async logoBytes(station) {
    if (station.logo.kind === 'local') return this.store.readLogo(station.id);
    const raw = this.rawLogoRef(station.id);
    const ref = parseLogoRef(raw);
    if (!ref) return null;
    const key = ref.path ? `${ref.path}@${ref.version}` : ref.url;
    if (this.logoCache.has(key)) return this.logoCache.get(key);
    let bytes = null;
    if (ref.path) {
      bytes = await this.repoBytes(ref.path);
    } else if (ref.url) {
      const { res } = await httpGet(ref.url, { headers: { 'User-Agent': 'SceneRadioWeb/1.0', Accept: 'image/*' }, headerTimeout: 10000 });
      const type = String(res.headers['content-type'] || '');
      if (res.statusCode === 200 && type.startsWith('image/')) bytes = await readLimited(res, MAX_EXTERNAL_LOGO);
      else res.destroy();
    }
    if (bytes) this.remember(key, bytes);
    return bytes;
  }

  rawLogoRef(id) {
    return this.repoStations.find((s) => slugify(s.name) === id)?.logo ?? null;
  }

  // ---------------------------------------------------------------- stream-status.json

  async repoStatus() {
    if (Date.now() - this.statusCache.at < 60000) return this.statusCache.value;
    let value = null;
    try {
      const text = await this.repoText('stream-status.json');
      value = text ? parseRepoStreamStatus(text) : null;
    } catch {
      value = null;
    }
    this.statusCache = { at: Date.now(), value };
    return value;
  }
}
