// Kijkt of er een nieuwere versie van deze webapp is: de nieuwste GitHub Release van de repository
// (standaard onneau/sceneradio-web). Een container kan zichzelf niet vervangen; de webapp laat alleen zien
// DAT er een update is en wat er nieuw is. Bijwerken doe je met "docker compose pull" en "docker compose up -d".
import { both, pick, currentLang } from './i18n.js';

const MAX_NOTES = 8;
const MAX_NOTE_LENGTH = 200;
const ERROR_RETRY_MS = 10 * 60 * 1000;

/** "v1.10.0" -> [1, 10, 0]; null als het geen versienummer is. */
export function parseVersion(text) {
  const clean = String(text ?? '').trim().replace(/^v/i, '');
  if (!/^\d+(\.\d+){0,3}$/.test(clean)) return null;
  return clean.split('.').map(Number);
}

/** Per deel als getal vergelijken, zodat 1.10 hoger is dan 1.9. -1, 0 of 1. */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * De opsommingstekens uit de Release-tekst; zonder opsomming de gewone regels (zonder koppen).
 * Staan er koppen "### Nederlands" en "### English" in (zoals in de changelog van de apps), dan telt alleen het deel van
 * de gevraagde taal; heeft die taal geen regels, dan het andere deel.
 */
export function parseNotes(body, lang = 'nl') {
  let lines = String(body ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim());
  const sections = { nl: [], en: [] };
  let section = null;
  let seen = false;
  for (const line of lines) {
    const heading = /^#{2,4}\s*(nederlands|english)\s*$/i.exec(line);
    if (heading) {
      section = heading[1].toLowerCase() === 'english' ? 'en' : 'nl';
      seen = true;
    } else if (section) {
      sections[section].push(line);
    }
  }
  if (seen) {
    const other = lang === 'en' ? 'nl' : 'en';
    lines = sections[lang].some(Boolean) ? sections[lang] : sections[other];
  }
  const bullets = lines.filter((line) => /^[-*] /.test(line)).map((line) => line.slice(2).trim());
  const picked = (bullets.length ? bullets : lines.filter((line) => line && !line.startsWith('#')))
    .filter(Boolean)
    .slice(0, MAX_NOTES);
  return picked.map((line) => (line.length > MAX_NOTE_LENGTH ? `${line.slice(0, MAX_NOTE_LENGTH - 1)}…` : line));
}

function releaseUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : null;
  } catch {
    return null;
  }
}

export class UpdateChecker {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
    this.enabled = Boolean(config.updateCheck) && /^[\w.-]+\/[\w.-]+$/.test(config.updateRepo || '');
    this.latest = null;
    this.notesByLang = { nl: [], en: [] };
    this.url = null;
    this.publishedAt = null;
    this.error = null;
    this.checkedAt = 0; // laatste geslaagde controle
    this.nextAt = 0; // niet eerder dan nu opnieuw vragen (tenzij handmatig)
    this.lastAttempt = 0;
    this.pending = null;
  }

  view() {
    const current = this.config.version;
    return {
      enabled: this.enabled,
      repo: this.config.updateRepo,
      current,
      latest: this.latest,
      available: this.latest !== null && compareVersions(this.latest, current) > 0,
      notes: this.notesByLang[currentLang()] || [],
      url: this.url,
      publishedAt: this.publishedAt,
      checkedAt: this.checkedAt || null,
      error: this.error ? pick(this.error) : null
    };
  }

  /** Geeft de laatst bekende stand en haalt zo nodig de nieuwste Release op. `force`: ook als de bewaartijd nog loopt. */
  async get({ force = false } = {}) {
    if (!this.enabled) return this.view();
    const now = Date.now();
    if (this.pending) {
      await this.pending;
      return this.view();
    }
    if (force) {
      if (now - this.lastAttempt < this.config.updateMinRecheckMs) return this.view();
    } else if (now < this.nextAt) {
      return this.view();
    }
    this.pending = this.refresh(now).finally(() => {
      this.pending = null;
    });
    await this.pending;
    return this.view();
  }

  async refresh(now) {
    this.lastAttempt = now;
    const token = this.config.readToken;
    const url = `${this.config.apiUrl}/repos/${this.config.updateRepo}/releases/latest`;
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SceneRadioWeb/1.0'
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    let text;
    try {
      response = await this.fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      text = await response.text();
    } catch (e) {
      return this.fail(now, both(`Geen verbinding met GitHub: ${e?.cause?.code || e?.message || 'onbekende fout'}`, `No connection to GitHub: ${e?.cause?.code || e?.message || 'unknown error'}`));
    }

    if (response.status === 401) return this.fail(now, both('Het GitHub-token is ongeldig of verlopen (401).', 'The GitHub token is invalid or has expired (401).'));
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      return this.fail(now, both('GitHub-limiet bereikt; later opnieuw proberen.', 'GitHub rate limit reached; try again later.'));
    }
    if (response.status === 403 || response.status === 404) {
      return this.fail(
        now,
        both(`Geen release gevonden of geen toegang tot ${this.config.updateRepo} (${response.status}). Is de repository privé, voeg hem dan toe aan GITHUB_READ_TOKEN (Contents: Read-only).`,
          `No release found or no access to ${this.config.updateRepo} (${response.status}). Is the repository private? Then add it to GITHUB_READ_TOKEN (Contents: Read-only).`)
      );
    }
    if (!response.ok) return this.fail(now, both(`GitHub-fout ${response.status}.`, `GitHub error ${response.status}.`));

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return this.fail(now, both('Onverwacht antwoord van GitHub.', 'Unexpected response from GitHub.'));
    }
    const version = String(data?.tag_name ?? '').trim().replace(/^v/i, '');
    if (!parseVersion(version)) return this.fail(now, both(`Onverwacht versienummer in de release: "${String(data?.tag_name ?? '').slice(0, 30)}".`, `Unexpected version number in the release: "${String(data?.tag_name ?? '').slice(0, 30)}".`));

    this.latest = version;
    this.notesByLang = { nl: parseNotes(data.body, 'nl'), en: parseNotes(data.body, 'en') };
    this.url = releaseUrl(data.html_url);
    this.publishedAt = typeof data.published_at === 'string' ? data.published_at.slice(0, 25) : null;
    this.error = null;
    this.checkedAt = now;
    this.nextAt = now + this.config.updateTtlMs;
    return undefined;
  }

  fail(now, message) {
    this.error = message; // een both()-object
    this.nextAt = now + Math.min(ERROR_RETRY_MS, this.config.updateTtlMs);
    return undefined;
  }
}
