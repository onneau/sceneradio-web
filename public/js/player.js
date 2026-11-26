// De speler: speelt de stream van een zender af via de server (zodat ook http-streams werken), houdt de
// verbinding in leven, haalt de titel (artiest - titel) op en regelt de knoppen van het toestel/de browser.
import { state, update, writeJson, currentStation } from './state.js';
import { SpectrumAnalyser } from './visualizer.js';
import { splitTitle } from './title.js';
import { tr, lang } from './i18n.js';
import { BRAND } from './brand.js';

export { splitTitle };

const audio = document.getElementById('audio');
let audioContext = null;
let analyser = null;
let analyserFailed = false;
let titleTimer = 0;
let retryTimer = 0;
let retries = 0;
let wantPlaying = false;
let lastLevelTime = 0;

const MAX_RETRIES = 3;

function ensureAnalyser() {
  if (analyser || analyserFailed || !state.visualizer) return;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    audioContext = new Context();
    const source = audioContext.createMediaElementSource(audio);
    analyser = new SpectrumAnalyser(audioContext, source);
    source.connect(audioContext.destination);
  } catch {
    analyserFailed = true;
    analyser = null;
  }
}

/** Het spectrum van dit moment (24 waarden van 0 tot 1), of null als er niets te meten valt. */
export function getLevels(now) {
  if (!analyser || state.status !== 'playing') {
    analyser?.reset();
    lastLevelTime = now;
    return null;
  }
  const dt = Math.min(0.1, Math.max(0.001, now - lastLevelTime));
  lastLevelTime = now;
  return analyser.update(dt);
}

function setMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const station = currentStation();
  if (!station) return;
  // De hoes van het nummer (als die is opgezocht) gaat voor het logo van de zender.
  const artwork = state.art
    ? [{ src: state.art.src, sizes: '500x500' }]
    : station.logo ? [{ src: `/api/logo/${station.id}?v=${encodeURIComponent(station.logo.v || '')}`, sizes: '192x192', type: 'image/jpeg' }] : [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }];
  const [artist, title] = splitTitle(state.title);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: title || station.name,
    artist: title ? artist || station.name : station.name,
    album: title ? station.name : BRAND.name,
    artwork
  });
  navigator.mediaSession.playbackState = state.status === 'playing' ? 'playing' : state.status === 'loading' ? 'playing' : 'paused';
}

/** Voor art.js: de bediening van het toestel toont de nieuwe hoes. */
export function refreshMediaSession() {
  setMediaSession();
}

function stopTitlePolling() {
  clearInterval(titleTimer);
  titleTimer = 0;
}

function startTitlePolling(id) {
  stopTitlePolling();
  const poll = async () => {
    if (state.currentId !== id || state.status === 'idle' || state.status === 'paused') return;
    try {
      const response = await fetch(`/api/nowplaying/${id}`, { cache: 'no-store', headers: { 'X-Lang': lang() } });
      if (!response.ok) return;
      const { title } = await response.json();
      if (state.currentId === id && title !== state.title) {
        update({ title });
        setMediaSession();
      }
    } catch {
      // geen verbinding: de volgende ronde probeert het weer
    }
  };
  setTimeout(poll, 1500);
  titleTimer = setInterval(poll, 8000);
}

/** Probeert te achterhalen waarom een stream niet start, zodat de melding iets zegt. */
async function explainFailure(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`/api/stream/${id}`, { signal: controller.signal, cache: 'no-store', headers: { 'X-Lang': lang() } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return data.error || tr(`Fout ${response.status}`, `Error ${response.status}`);
    }
    controller.abort();
    return '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function start(id) {
  clearTimeout(retryTimer);
  wantPlaying = true;
  update({ currentId: id, status: 'loading', error: '' });
  ensureAnalyser();
  audioContext?.resume?.().catch(() => {});
  audio.src = `/api/stream/${encodeURIComponent(id)}?t=${Date.now()}`;
  audio.volume = state.volume;
  const attempt = audio.play();
  if (attempt && typeof attempt.catch === 'function') {
    attempt.catch((error) => {
      if (error?.name === 'AbortError') return; // een nieuwe zender werd gekozen
      if (error?.name === 'NotAllowedError') {
        update({ status: 'paused', error: '' });
        return;
      }
      handleFailure(id);
    });
  }
  setMediaSession();
}

async function handleFailure(id) {
  if (!wantPlaying || state.currentId !== id) return;
  if (retries < MAX_RETRIES) {
    retries++;
    update({ status: 'loading' });
    retryTimer = setTimeout(() => state.currentId === id && wantPlaying && start(id), 1500 * retries);
    return;
  }
  const reason = await explainFailure(id);
  if (state.currentId !== id) return;
  wantPlaying = false;
  stopTitlePolling();
  update({ status: 'error', error: reason ? tr(`Deze zender reageert niet (${reason}).`, `This station is not responding (${reason}).`) : tr('De stream is gestopt.', 'The stream has stopped.') });
}

export function initPlayer() {
  audio.volume = state.volume;
  audio.addEventListener('playing', () => {
    retries = 0;
    update({ status: 'playing', error: '' });
    startTitlePolling(state.currentId);
    setMediaSession();
  });
  audio.addEventListener('waiting', () => {
    if (wantPlaying) update({ status: 'loading' });
  });
  audio.addEventListener('error', () => {
    if (wantPlaying) handleFailure(state.currentId);
  });
  audio.addEventListener('ended', () => {
    if (wantPlaying) handleFailure(state.currentId);
  });
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => resume());
    navigator.mediaSession.setActionHandler('pause', () => pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
  }
  document.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); toggle(); }
    else if (event.code === 'ArrowRight') step(1);
    else if (event.code === 'ArrowLeft') step(-1);
  });
}

/** Kiest een zender en begint meteen te spelen. */
export function play(id) {
  retries = 0;
  stopTitlePolling();
  writeJson('ew.last', id);
  update({ title: null });
  start(id);
}

export function pause() {
  wantPlaying = false;
  clearTimeout(retryTimer);
  stopTitlePolling();
  audio.pause();
  // Een live stream pauzeren heeft geen zin: we sluiten de verbinding en pakken bij "afspelen" de live-stream weer op.
  audio.removeAttribute('src');
  audio.load();
  update({ status: 'paused', error: '' });
  setMediaSession();
}

export function resume() {
  const station = currentStation();
  if (station) play(station.id);
}

export function toggle() {
  if (!currentStation()) {
    const first = state.stations[0];
    if (first) play(first.id);
    return;
  }
  if (state.status === 'playing' || state.status === 'loading') pause();
  else resume();
}

/** Volgende (+1) of vorige (-1) zender uit de lijst. */
export function step(delta) {
  const list = state.stations;
  if (list.length === 0) return;
  const index = list.findIndex((s) => s.id === state.currentId);
  const next = index < 0 ? 0 : (index + delta + list.length) % list.length;
  play(list[next].id);
}

export function setVolume(value) {
  const volume = Math.min(1, Math.max(0, value));
  audio.volume = volume;
  writeJson('ew.volume', volume);
  update({ volume });
}

/** Zet de visualizer aan of uit; de geluidsmeting wordt pas bij de volgende pagina-start (her)gebouwd. */
export function visualizerChanged() {
  if (!state.visualizer) analyser?.reset();
}
