// Het account in deze browser. Wie is ingelogd, krijgt zijn favorieten en instellingen van de server en bewaart wijzigingen
// daar weer; zo is alles op elk apparaat hetzelfde. In de browser blijft een kopie (localStorage) staan, zodat de pagina
// meteen werkt en ook als de server even niet bereikbaar is.
//
// Het profiel is hetzelfde bestand als de back-up (backup.js): taal, visualizer, slogans, volume, favorieten, laatste zender.
// De server houdt per account één profiel met een tijdstip (updatedAt). Hier onthouden we per browser (sleutel ew.account):
//   name       van wie de kopie in deze browser is
//   updatedAt  de versie van het profiel waar de kopie op gebaseerd is
//   dirty      er zijn wijzigingen die nog niet naar de server zijn
//
// Bij het openen van de pagina (reconcile) geldt:
//   - eerste keer inloggen in deze browser: de favorieten van de server en van deze browser worden samengevoegd, voor de
//     instellingen gaat het profiel op de server voor (als dat er is)
//   - een ander account dan de vorige keer: de kopie van de vorige gebruiker wordt gewist en het profiel van de server gebruikt
//   - hetzelfde account en de server is verder dan de kopie: de server gaat voor, tenzij hier nog niet-bewaarde wijzigingen zijn;
//     dan blijven de instellingen van deze browser gelden en worden de favorieten samengevoegd (er raakt nooit een favoriet kwijt)
//   - anders: de kopie is het nieuwste en gaat zo nodig naar de server
// Wijzigingen van een ander apparaat zie je na het vernieuwen van de pagina; er wordt niets midden in het luisteren veranderd.
import { api } from './api.js';
import { state, SYNCED_KEYS, setSyncHook, reloadFromStorage } from './state.js';
import { makeBackup, parseBackup } from './backup.js';
import { langSetting, setLangSetting } from './i18n.js';

const META = 'ew.account';
/** setTimeout, maar het wachten houdt een test of ander proces niet open. */
function later(fn, ms) {
  const id = setTimeout(fn, ms);
  id?.unref?.();
  return id;
}
const PUSH_DELAY_MS = 1500;
const RETRY_DELAY_MS = 30 * 1000;

function readStored(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // opslag geblokkeerd: dan werkt alles alleen tot de pagina wordt vernieuwd
  }
}

function readMeta() {
  const value = readStored(META);
  return value && typeof value === 'object' && typeof value.name === 'string' ? { name: value.name, updatedAt: Number(value.updatedAt) || 0, dirty: Boolean(value.dirty) } : null;
}

/** Wat deze browser nu heeft, in de vorm van een back-up. Alleen aanroepen als `state` de opslag weerspiegelt. */
function snapshot() {
  return { language: langSetting(), visualizer: state.visualizer, vis: state.vis, slogans: state.slogans, volume: state.volume, favorites: [...state.favorites], last: state.currentId };
}

/** Het antwoord van parseBackup omzetten naar dezelfde vorm als snapshot(); wat het profiel niet heeft, blijft zoals het was. */
function fromProfile(b, fallback) {
  return {
    language: b.language,
    visualizer: b.visualizer ?? fallback.visualizer,
    vis: b.vis ?? fallback.vis,
    slogans: b.slogans,
    volume: b.volume ?? fallback.volume,
    favorites: b.favorites,
    last: b.lastStation
  };
}

/** Samenvoegen: de favorieten van beide kanten, de rest van de kant die voorrang heeft. */
function union(preferred, other) {
  return { ...preferred, favorites: [...new Set([...preferred.favorites, ...other.favorites])] };
}

/** Een snapshot in de opslag zetten en de pagina-toestand opnieuw lezen. */
function applyLocal(snap) {
  writeStored('ew.favorites', snap.favorites);
  writeStored('ew.last', snap.last);
  writeStored('ew.volume', snap.volume);
  writeStored('ew.visualizer', snap.visualizer);
  writeStored('ew.vis', snap.vis);
  writeStored('ew.slogans', snap.slogans);
  reloadFromStorage();
  setLangSetting(snap.language);
}

/** Alles wat bij het account hoort uit deze browser halen (bij uitloggen). De taal blijft: die is van het apparaat. */
export function wipeLocal() {
  for (const key of SYNCED_KEYS) writeStored(key, null);
  writeStored(META, null);
  reloadFromStorage();
}

// ---------------------------------------------------------------------------------------------- bij het openen

/** Zorgt dat deze browser en de server van `user` hetzelfde profiel hebben, voordat de pagina wordt opgebouwd. */
export async function reconcile(user) {
  reloadFromStorage(); // wat er in de opslag staat is leidend; de pagina-toestand kan van vóór een andere tab zijn
  const meta = readMeta();
  let server;
  try {
    server = (await api('/api/me')).profile;
  } catch (error) {
    if (error.status === 401) throw error;
    // De server geeft het profiel nu niet: we werken met de kopie in deze browser (als die van dit account is) en proberen het later weer.
    if (meta && meta.name !== user.name) wipeLocal();
    return { ok: false };
  }
  const parsed = server ? parseBackup(server.backup) : null;
  const remote = parsed?.backup ? fromProfile(parsed.backup, snapshot()) : null;
  let push = false;

  if (meta && meta.name !== user.name) {
    wipeLocal(); // de kopie van een ander account hoort hier niet te blijven staan
    if (remote) applyLocal(remote);
  } else if (!meta) {
    if (remote) applyLocal(union(remote, snapshot()));
    push = true; // de server moet ook weten wat er in deze browser stond
  } else if (!remote) {
    push = true;
  } else if (server.updatedAt !== meta.updatedAt) {
    if (meta.dirty) {
      applyLocal(union(snapshot(), remote));
      push = true;
    } else {
      applyLocal(remote);
    }
  } else {
    push = meta.dirty;
  }

  writeStored(META, { name: user.name, updatedAt: server?.updatedAt ?? 0, dirty: push });
  if (push) await pushNow(user, { quiet: true });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------- bewaren

let account = null; // { name } zolang er gesynchroniseerd wordt
let timer = 0;
let busy = false;
let again = false;
let version = 0; // telt elke wijziging, om te weten of er tijdens het bewaren nog iets veranderd is
export const sync = { state: 'idle', error: '' }; // idle | pending | saving | saved | error

function setStatus(next, error = '') {
  sync.state = next;
  sync.error = error;
  document.dispatchEvent(new CustomEvent('ew:sync'));
}

function changed() {
  if (!account) return;
  version += 1;
  const meta = readMeta();
  writeStored(META, { name: account.name, updatedAt: meta?.name === account.name ? meta.updatedAt : 0, dirty: true });
  setStatus('pending');
  clearTimeout(timer);
  timer = later(() => pushNow(account), PUSH_DELAY_MS);
}

/** Het profiel nu naar de server sturen. Mislukt dat, dan blijft het "dirty" en proberen we het straks opnieuw. */
export async function pushNow(user = account, { quiet = false, keepalive = false } = {}) {
  clearTimeout(timer);
  if (!user) return;
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  const sent = version;
  if (!quiet) setStatus('saving');
  try {
    const result = await api('/api/me/profile', { method: 'POST', body: { backup: makeBackup('sync', snapshot()) }, keepalive });
    const stillDirty = version !== sent;
    writeStored(META, { name: user.name, updatedAt: result.updatedAt, dirty: stillDirty });
    if (stillDirty) again = true;
    if (account) setStatus(stillDirty ? 'pending' : 'saved');
  } catch (error) {
    if (error.status !== 401 && account) {
      setStatus('error', error.message);
      clearTimeout(timer);
      timer = later(() => pushNow(user), RETRY_DELAY_MS);
    }
  } finally {
    busy = false;
    if (again) {
      again = false;
      clearTimeout(timer);
      timer = later(() => pushNow(user), PUSH_DELAY_MS);
    }
  }
}

/** Begint met bewaren zodra er iets verandert. Pas aanroepen als de pagina staat. */
export function startSync(user) {
  account = { name: user.name };
  setSyncHook(changed);
  document.addEventListener('ew:lang', changed);
  // Een tab die naar de achtergrond gaat of sluit, bewaart meteen wat er nog open staat.
  const flush = () => { if (account && readMeta()?.dirty) pushNow(account, { quiet: true, keepalive: true }); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  globalThis.addEventListener?.('pagehide', flush);
  const dirty = Boolean(readMeta()?.dirty);
  setStatus(dirty ? 'pending' : 'saved');
  if (dirty) timer = later(() => pushNow(account), PUSH_DELAY_MS); // een eerdere poging (bij het openen) is niet gelukt
}

// ---------------------------------------------------------------------------------------------- uitloggen en wachtwoord

function leave() {
  account = null;
  clearTimeout(timer);
  wipeLocal();
  location.reload();
}

/** Bewaren afmaken voor we iets wissen: wacht op een lopend verzoek en stuurt wat er nog open staat. */
async function settle() {
  for (let i = 0; i < 60 && busy; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  if (account && readMeta()?.dirty) {
    await pushNow(account, { quiet: true });
    for (let i = 0; i < 60 && busy; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Uitloggen: eerst bewaren wat nog open staat, dan de cookie weg en de kopie in deze browser wissen. */
export async function logout() {
  await settle();
  try {
    await api('/api/logout', { method: 'POST', body: {} });
  } catch {
    // de cookie verloopt vanzelf
  }
  leave();
}

/** Uitloggen op alle apparaten tegelijk. */
export async function logoutEverywhere() {
  await settle();
  await api('/api/me/logout-all', { method: 'POST', body: {} });
  leave();
}

export function changePassword(current, next) {
  return api('/api/me/password', { method: 'POST', body: { current, next } });
}
