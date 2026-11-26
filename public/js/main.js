// Start van de pagina: bouwt het scherm op (navigatie, hoofdgebied, speler) en laadt de zenders.
import { h, icon, toast } from './dom.js';
import { state, subscribe, update, currentStation } from './state.js';
import { loadConfig, loadStations } from './library.js';
import { initPlayer } from './player.js';
import { createPlayerPanel, createMiniPlayer } from './views/player-panel.js';
import { createStationsView } from './views/stations.js';
import { createSettingsView } from './views/settings.js';
import { initArt } from './art.js';
import { tr } from './i18n.js';
import { BRAND } from './brand.js';

const nav = () => [
  ['zenders', tr('Zenders', 'Stations'), 'list'],
  ['speler', tr('Speler', 'Player'), 'radio'],
  ['instellingen', tr('Instellingen', 'Settings'), 'gear']
];
const MAIN_VIEWS = new Set(['zenders', 'instellingen']);
const REFRESH_MS = 5 * 60 * 1000;

const views = {
  zenders: createStationsView(),
  instellingen: createSettingsView()
};

let view = 'zenders';
let mainView = 'zenders';
let lastRefresh = Date.now();

function navButton(id, label, iconName) {
  return h('button', {
    class: 'nav-item', type: 'button', 'data-view': id, 'aria-label': label,
    onclick: () => { if (location.hash !== `#${id}`) location.hash = id; else show(id); }
  }, h('span', { class: 'pill' }, icon(iconName, 24)), h('span', { class: 'lbl' }, label));
}

/** De namen in het menu opnieuw zetten, bijvoorbeeld na een andere taal. */
function relabel() {
  const labels = new Map(nav().map(([id, label]) => [id, label]));
  for (const button of document.querySelectorAll('.nav-item')) {
    const label = labels.get(button.dataset.view);
    if (!label) continue;
    button.setAttribute('aria-label', label);
    button.querySelector('.lbl').textContent = label;
  }
  for (const menu of document.querySelectorAll('nav.side, nav.bottom')) menu.setAttribute('aria-label', tr('Hoofdmenu', 'Main menu'));
  document.title = pageTitle();
}

function buildShell() {
  const app = document.getElementById('app');
  const side = h('nav', { class: 'side', 'aria-label': tr('Hoofdmenu', 'Main menu') },
    h('div', { class: 'brand' }, h('img', { src: '/icons/icon-192.png', alt: BRAND.name })),
    nav().map(([id, label, glyph]) => navButton(id, label, glyph)));
  const main = h('main', { class: 'main', id: 'main' }, Object.values(views).map((v) => v.el));
  const panel = createPlayerPanel();
  const mini = createMiniPlayer(() => { location.hash = 'speler'; });
  const bottom = h('nav', { class: 'bottom', 'aria-label': tr('Hoofdmenu', 'Main menu') }, nav().map(([id, label, glyph]) => navButton(id, label, glyph)));
  app.replaceChildren(side, main, panel, mini, bottom);
}

function show(next) {
  if (!nav().some(([id]) => id === next)) next = 'zenders';
  view = next;
  if (MAIN_VIEWS.has(next)) mainView = next;
  document.body.dataset.view = next;
  for (const [id, v] of Object.entries(views)) v.el.hidden = id !== mainView;
  for (const button of document.querySelectorAll('.nav-item')) {
    const selected = button.dataset.view === (next === 'speler' ? 'speler' : mainView);
    button.classList.toggle('sel', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  if (MAIN_VIEWS.has(next)) {
    views[next].enter?.();
    document.getElementById('main')?.scrollTo({ top: 0 });
  }
}

function fromHash() {
  show(location.hash.replace(/^#/, '') || 'zenders');
}

async function refresh({ withConfig = false } = {}) {
  lastRefresh = Date.now();
  if (withConfig) {
    try {
      await loadConfig();
    } catch (error) {
      toast(error.message, { bad: true });
    }
  }
  await loadStations();
  // Een zender die niet meer in de lijst staat, vergeten we.
  if (state.currentId && state.stations.length && !currentStation()) update({ currentId: null, status: 'idle', title: null });
}

function pageTitle() {
  const station = currentStation();
  return station && state.status === 'playing' ? `▶ ${station.name} · ${BRAND.name}` : BRAND.name;
}

function watchTitle() {
  subscribe(() => { document.title = pageTitle(); });
}

function boot() {
  buildShell();
  initPlayer();
  initArt();
  watchTitle();


  window.addEventListener('hashchange', fromHash);
  // Een andere taal: menu en titel opnieuw, de zichtbare pagina opnieuw tekenen (de speler speelt gewoon door).
  document.addEventListener('ew:lang', () => {
    relabel();
    fromHash();
    update({});
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastRefresh > 60 * 1000) refresh();
  });
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);

  fromHash();
  refresh({ withConfig: true }).then(() => {
    // De instellingen en het beheer tonen config-gegevens: opnieuw tekenen nu die er is.
    if (MAIN_VIEWS.has(view) || view === 'speler') views[mainView].enter?.();
  });
}

boot();
