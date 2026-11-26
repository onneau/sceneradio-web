// De hoes of artiestenfoto van het nummer dat speelt. De server zoekt ze op (MusicBrainz, Cover Art Archive, Wikimedia,
// Deezer) en bewaart ze; deze pagina stuurt alleen artiest en titel naar de eigen server. Zonder artiest en titel, of
// als hoezen niet gevraagd zijn (Instellingen > Weergave), gebeurt er niets.
import { state, subscribe, update } from './state.js';
import { splitTitle } from './title.js';
import { lang } from './i18n.js';
import { refreshMediaSession } from './player.js';

const DELAY_MS = 800; // even wachten: een nummer dat meteen weer wisselt hoeft niet te worden opgezocht

let key = '';
let timer = 0;
let controller = null;
let current = null;

function release() {
  if (current) URL.revokeObjectURL(current.url);
  current = null;
}

function wanted() {
  if (!state.config?.covers) return null;
  if (!state.vis.cover && !state.vis.coverInPlayer) return null;
  if (state.status !== 'playing' && state.status !== 'loading') return null;
  const [artist, title] = splitTitle(state.title);
  if (!artist || !title) return null;
  return { artist, title, photo: state.vis.artistPhoto && Boolean(state.config?.covers) };
}

async function load(want, expected) {
  controller = new AbortController();
  const src = `/api/art?artist=${encodeURIComponent(want.artist)}&title=${encodeURIComponent(want.title)}${want.photo ? '&photo=1' : ''}`;
  try {
    const response = await fetch(src, { signal: controller.signal, headers: { 'X-Lang': lang() } });
    if (!response.ok || key !== expected) return; // geen hoes (404), te druk (503) of te veel verzoeken (429)
    const blob = await response.blob();
    if (key !== expected) return;
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.src = url;
    await image.decode();
    if (key !== expected) {
      URL.revokeObjectURL(url);
      return;
    }
    current = { image, url, src, kind: response.headers.get('X-Art-Kind') === 'photo' ? 'photo' : 'cover' };
    update({ art: current });
    refreshMediaSession();
  } catch {
    // geen hoes: de visualizer en de speler blijven bij het logo
  }
}

function sync() {
  const want = wanted();
  const next = want ? `${want.artist}\n${want.title}\n${want.photo ? 1 : 0}` : '';
  if (next === key) return;
  key = next;
  clearTimeout(timer);
  controller?.abort();
  if (state.art) {
    release();
    update({ art: null });
    refreshMediaSession();
  }
  if (want) timer = setTimeout(() => load(want, next), DELAY_MS);
}

export function initArt() {
  subscribe(sync);
  sync();
}
