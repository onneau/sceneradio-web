// Alle instellingen komen uit omgevingsvariabelen (zie docker-compose.yml en README.md).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

function flag(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'ja', 'on'].includes(String(value).trim().toLowerCase());
}

function number(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;
  } catch {
    return '1.1.1';
  }
}

export function loadConfig(env = process.env) {
  const clean = (v) => (v === undefined ? '' : String(v).trim());
  return {
    version: packageVersion(),
    port: number(env.PORT, 8080, 1, 65535),
    publicDir: env.PUBLIC_DIR || path.join(here, '..', 'public'),
    dataDir: env.DATA_DIR || '/data',

    owner: clean(env.GITHUB_OWNER) || 'onneau',
    repo: clean(env.GITHUB_REPO) || 'sceneradio-m3u',
    ref: clean(env.GITHUB_REF) || 'main',
    playlistPath: clean(env.PLAYLIST_PATH) || 'nederlandse-radio.m3u',
    apiUrl: (clean(env.GITHUB_API_URL) || 'https://api.github.com').replace(/\/+$/, ''),
    rawUrl: (clean(env.GITHUB_RAW_URL) || 'https://raw.githubusercontent.com').replace(/\/+$/, ''),
    readToken: clean(env.GITHUB_READ_TOKEN),

    trustProxy: flag(env.TRUST_PROXY),

    playlistTtlMs: number(env.PLAYLIST_TTL_SECONDS, 300, 10, 86400) * 1000,
    allowPrivateStreams: flag(env.ALLOW_PRIVATE_STREAMS),
    maxListeners: number(env.MAX_LISTENERS, 40, 1, 500),

    // Hoezen en artiestenfoto's (de server zoekt ze op bij MusicBrainz, het Cover Art Archive, Wikimedia en Deezer).
    covers: flag(env.COVERS, true),
    coversDeezer: false, // geen Deezer in de publieke versie: alleen Wikimedia
    coversRatePerMinute: number(env.COVERS_RATE_PER_MINUTE, 30, 1, 600),
    coversGapMs: number(env.COVERS_GAP_MS, 1100, 0, 10000),
    userAgent: `SceneRadioWeb/${packageVersion()} ( https://github.com/onneau/sceneradio-web )`,

    // Melding in Instellingen als er een nieuwere versie van de webapp is (GitHub Releases).
    updateCheck: flag(env.UPDATE_CHECK, true),
    updateRepo: clean(env.UPDATE_REPO) || 'onneau/sceneradio-web',
    updateTtlMs: number(env.UPDATE_TTL_SECONDS, 21600, 60, 604800) * 1000,
    updateMinRecheckMs: number(env.UPDATE_MIN_RECHECK_SECONDS, 15, 0, 3600) * 1000
  };
}
