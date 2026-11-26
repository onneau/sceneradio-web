// Praat met GitHub: de M3U en logo's lezen (zonder token via de publieke raw-adressen).
import { RepoError } from './repofiles.js';
import { both } from './i18n.js';

const ACCEPT_JSON = 'application/vnd.github+json';
const ACCEPT_RAW = 'application/vnd.github.raw+json';

export class GitHubError extends RepoError {}

export class GitHubRepo {
  constructor(config, token) {
    this.config = config;
    this.token = token || '';
    this.name = `${config.owner}/${config.repo}`;
  }

  get hasToken() {
    return this.token !== '';
  }

  async call(method, apiPath, { json, query, accept = ACCEPT_JSON, binary = false } = {}) {
    const url = new URL(`${this.config.apiUrl}/repos/${this.name}/${apiPath}`);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
    const headers = {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SceneRadioWeb/1.0'
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let body;
    if (json !== undefined) {
      body = JSON.stringify(json);
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }
    let response;
    try {
      response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      throw new GitHubError(both(`Geen verbinding met GitHub: ${e?.cause?.code || e?.message || 'onbekende fout'}`, `No connection to GitHub: ${e?.cause?.code || e?.message || 'unknown error'}`));
    }
    const data = binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    return { code: response.status, body: data };
  }

  static messageOf(reply) {
    try {
      return String(JSON.parse(reply.body).message || '');
    } catch {
      return '';
    }
  }

  failure(reply, { write = true } = {}) {
    if (reply.code === 401) return new GitHubError(both('Het token is ongeldig of verlopen (401).', 'The token is invalid or has expired (401).'), 401);
    if (reply.code === 403 || reply.code === 404) {
      return new GitHubError(
        write
          ? both(`Dit token mag niet schrijven naar ${this.name} (${reply.code}). Maak een fine-grained token voor alleen die repository met Contents: Read and write.`, `This token may not write to ${this.name} (${reply.code}). Create a fine-grained token for only that repository with Contents: Read and write.`)
          : both(`Geen toegang tot ${this.name} (${reply.code}). Controleer GITHUB_READ_TOKEN: een fine-grained token voor alleen die repository met Contents: Read-only.`, `No access to ${this.name} (${reply.code}). Check GITHUB_READ_TOKEN: a fine-grained token for only that repository with Contents: Read-only.`),
        reply.code
      );
    }
    return new GitHubError(both(`GitHub-fout ${reply.code}: ${GitHubRepo.messageOf(reply) || 'onbekend'}`, `GitHub error ${reply.code}: ${GitHubRepo.messageOf(reply) || 'unknown'}`), reply.code);
  }

  parse(reply) {
    try {
      return JSON.parse(reply.body);
    } catch {
      throw new GitHubError(both('Onverwacht antwoord van GitHub.', 'Unexpected response from GitHub.'), reply.code);
    }
  }

  /** Tekst van een bestand op een branch of commit; null als het bestand er niet is. */
  async readText(filePath, ref = this.config.ref, { write = false } = {}) {
    const reply = await this.call('GET', `contents/${encodePath(filePath)}`, { query: { ref }, accept: ACCEPT_RAW });
    if (reply.code === 200) return reply.body;
    if (reply.code === 404) return null;
    throw this.failure(reply, { write });
  }

  /** Bytes van een bestand (logo's); null als het bestand er niet is. */
  async readBytes(filePath, ref = this.config.ref) {
    const reply = await this.call('GET', `contents/${encodePath(filePath)}`, {
      query: { ref },
      accept: ACCEPT_RAW,
      binary: true
    });
    if (reply.code === 200) return reply.body;
    if (reply.code === 404) return null;
    throw this.failure(reply, { write: false });
  }

}

function encodePath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

