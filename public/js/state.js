// De gedeelde toestand van de pagina, met een eenvoudige abonneerfunctie.
import { DEFAULT_SLOGANS, MAX_SLOGANS, MAX_SLOGAN_LENGTH } from './brand.js';

const listeners = new Set();

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// De sleutels die bij een account horen: met inloggen gelden ze op elk apparaat (zie account.js). 'ew.lang' staat in i18n.js.
export const SYNCED_KEYS = ['ew.favorites', 'ew.last', 'ew.volume', 'ew.visualizer', 'ew.vis', 'ew.slogans'];
let syncHook = () => {};
export function setSyncHook(fn) {
  syncHook = fn;
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // opslag geblokkeerd (privé-venster): de instelling geldt dan alleen voor deze sessie
  }
  if (SYNCED_KEYS.includes(key)) syncHook(key);
}

// De weergave-instellingen van de visualizer en de speler (dezelfde keuzes als in de apps), in deze browser bewaard.
export const VIS_DEFAULTS = {
  copperMode: 'off',        // off | subtle | all
  sparkling: true,          // fonkelende sterren
  eqSensitivity: 1,         // 0,5 tot 1,5
  dim: true,                // dimmen na DIM_DELAY_SECONDS zonder beweging
  cover: false,             // hoes in de visualizer
  coverSize: 'small',       // small | medium | large
  coverPosition: 'default', // default | left | center | right
  coverInPlayer: false,     // hoes in de speler
  artistPhoto: false        // foto van de artiest als er geen hoes is
};
export const DIM_DELAY_SECONDS = 30;
export const DIM_LEVEL = 0.8;

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

export function coerceVis(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const eq = Number(v.eqSensitivity);
  return {
    copperMode: pick(v.copperMode, ['off', 'subtle', 'all'], VIS_DEFAULTS.copperMode),
    sparkling: flag(v.sparkling, VIS_DEFAULTS.sparkling),
    eqSensitivity: Number.isFinite(eq) ? Math.min(1.5, Math.max(0.5, eq)) : VIS_DEFAULTS.eqSensitivity,
    dim: flag(v.dim, VIS_DEFAULTS.dim),
    cover: flag(v.cover, VIS_DEFAULTS.cover),
    coverSize: pick(v.coverSize, ['small', 'medium', 'large'], VIS_DEFAULTS.coverSize),
    coverPosition: pick(v.coverPosition, ['default', 'left', 'center', 'right'], VIS_DEFAULTS.coverPosition),
    coverInPlayer: flag(v.coverInPlayer, VIS_DEFAULTS.coverInPlayer),
    artistPhoto: flag(v.artistPhoto, VIS_DEFAULTS.artistPhoto)
  };
}

/** Een sloganlijst uit een bestand of de opslag: tekst, bijgesneden, zonder lege regels; null als er niets bruikbaars staat. */
export function coerceSlogans(raw) {
  if (!Array.isArray(raw)) return null;
  const list = raw.filter((s) => typeof s === 'string').map((s) => s.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, MAX_SLOGAN_LENGTH).trim()).filter(Boolean).slice(0, MAX_SLOGANS);
  return list.length ? list : null;
}

export const state = {
  config: null,
  stations: [],
  updatedAt: null,
  loadError: '',
  loading: true,
  favorites: new Set(readJson('ew.favorites', [])),
  currentId: readJson('ew.last', null),
  status: 'idle', // idle | loading | playing | paused | error
  error: '',
  title: null,
  volume: readJson('ew.volume', 0.8),
  visualizer: readJson('ew.visualizer', true),
  vis: coerceVis(readJson('ew.vis', {})),
  slogans: coerceSlogans(readJson('ew.slogans', null)), // null = de standaardslogans
  art: null, // { image, url, kind } van het huidige nummer, of null
  user: null // { name, role: 'admin' | 'user' } als er is ingelogd, anders null
};

/** Alles uit de opslag van de browser opnieuw lezen (na het terugzetten van een account, of het wissen bij uitloggen). */
export function reloadFromStorage() {
  state.favorites = new Set(readJson('ew.favorites', []));
  state.currentId = readJson('ew.last', null);
  state.volume = readJson('ew.volume', 0.8);
  state.visualizer = readJson('ew.visualizer', true);
  state.vis = coerceVis(readJson('ew.vis', {}));
  state.slogans = coerceSlogans(readJson('ew.slogans', null));
}

export const isAdmin = () => state.user?.role === 'admin';

/** De slogans die nu door de visualizer lopen. */
export function activeSlogans() {
  return state.slogans || DEFAULT_SLOGANS;
}

export function setVis(patch) {
  state.vis = coerceVis({ ...state.vis, ...patch });
  writeJson('ew.vis', state.vis);
  update({});
}

/** Zet de sloganlijst; een lijst gelijk aan de standaard (of een lege) wordt "standaard". */
export function setSlogans(list) {
  const clean = coerceSlogans(list);
  const same = clean && clean.length === DEFAULT_SLOGANS.length && clean.every((s, i) => s === DEFAULT_SLOGANS[i]);
  state.slogans = same ? null : clean;
  writeJson('ew.slogans', state.slogans);
  update({});
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function update(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

/** Favorieten erbij (uit een back-up); bestaande blijven staan. */
export function addFavorites(ids) {
  for (const id of ids) state.favorites.add(id);
  writeJson('ew.favorites', [...state.favorites]);
  update({});
}

export function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  writeJson('ew.favorites', [...state.favorites]);
  update({});
}

export function currentStation() {
  return state.stations.find((s) => s.id === state.currentId) || null;
}
