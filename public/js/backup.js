// Back-up van de instellingen van deze browser in één .json-bestand, in dezelfde opzet als de back-up van de apps
// (format "radio-backup", formatVersion 1), maar met platform "web". Erin: taal, visualizer-instellingen, slogans,
// volume, favorieten en de laatste zender. Nooit: het beheerwachtwoord of tokens (die staan niet in de browser), en
// niet de zenderlijst, verborgen zenders of eigen logo's (die staan op de server in ./data).
// Dit bestand doet geen DOM-werk, zodat het te testen is; de pagina leest en zet de waarden zelf (zie views/settings.js).
import { coerceVis, coerceSlogans } from './state.js';

export const FORMAT = 'radio-backup';
export const FORMAT_VERSION = 1;
export const MAX_BYTES = 1024 * 1024;
const MAX_FAVORITES = 5000;
const ID = /^[a-z0-9-]{1,100}$/;

export function fileName(appPrefix, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${appPrefix}${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/** Het bestand als tekst. `snapshot` heeft language, visualizer, vis, slogans, volume, favorites en last. */
export function makeBackup(appId, snapshot, now = new Date()) {
  return JSON.stringify({
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    platform: 'web',
    app: appId,
    createdAt: now.toISOString(),
    settings: {
      language: ['nl', 'en'].includes(snapshot.language) ? snapshot.language : 'auto',
      visualizer: Boolean(snapshot.visualizer),
      vis: coerceVis(snapshot.vis),
      slogans: coerceSlogans(snapshot.slogans),
      volume: Math.min(1, Math.max(0, Number(snapshot.volume) || 0))
    },
    favorites: [...new Set((snapshot.favorites || []).filter((id) => typeof id === 'string' && ID.test(id)))].slice(0, MAX_FAVORITES),
    lastStation: typeof snapshot.last === 'string' && ID.test(snapshot.last) ? snapshot.last : null
  }, null, 1);
}

/**
 * Leest en controleert een bestand voordat er iets verandert. Geeft { backup } of { error } met een code:
 * 'big' (te groot), 'json' (geen geldig bestand), 'format' (geen back-up van deze apps), 'app-backup' (de back-up van een
 * Android-app, niet van een webapp), 'version' (van een nieuwere versie). Onbekende velden worden genegeerd.
 */
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) return { error: 'big' };
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    return { error: 'json' };
  }
  if (!root || typeof root !== 'object' || Array.isArray(root) || root.format !== FORMAT) return { error: 'format' };
  if (!Number.isInteger(root.formatVersion) || root.formatVersion < 1) return { error: 'format' };
  if (root.formatVersion > FORMAT_VERSION) return { error: 'version' };
  if (root.platform !== 'web') return { error: 'app-backup' };

  const s = root.settings && typeof root.settings === 'object' ? root.settings : {};
  const volume = Number(s.volume);
  const favorites = Array.isArray(root.favorites)
    ? [...new Set(root.favorites.filter((id) => typeof id === 'string' && ID.test(id)))].slice(0, MAX_FAVORITES)
    : [];
  return {
    backup: {
      app: typeof root.app === 'string' ? root.app.slice(0, 40) : '',
      createdAt: typeof root.createdAt === 'string' ? root.createdAt.slice(0, 40) : '',
      language: ['nl', 'en'].includes(s.language) ? s.language : 'auto',
      visualizer: typeof s.visualizer === 'boolean' ? s.visualizer : null,
      vis: s.vis && typeof s.vis === 'object' ? coerceVis(s.vis) : null,
      slogans: coerceSlogans(s.slogans),
      hasSlogans: Array.isArray(s.slogans),
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : null,
      favorites,
      lastStation: typeof root.lastStation === 'string' && ID.test(root.lastStation) ? root.lastStation : null
    }
  };
}
