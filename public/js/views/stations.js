// De pagina met zenders: zoeken, filteren op genre of favorieten, en afspelen met een tik.
import { h, icon, logoImage, replace } from '../dom.js';
import { state, subscribe, toggleFavorite } from '../state.js';
import { play } from '../player.js';
import { tr, locale } from '../i18n.js';

let genre = 'Alles';
let query = '';
let showAllGenres = false;

function matches(station) {
  if (genre === 'Favorieten' && !state.favorites.has(station.id)) return false;
  if (genre !== 'Alles' && genre !== 'Favorieten' && !station.genres.some((g) => g.toLowerCase() === genre.toLowerCase())) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return station.name.toLowerCase().includes(q) || station.genres.some((g) => g.toLowerCase().includes(q));
}

function genreCounts() {
  const counts = new Map();
  for (const station of state.stations) {
    for (const g of station.genres) {
      const key = g.toLowerCase();
      const entry = counts.get(key) || { name: g, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, locale()));
}

export function createStationsView() {
  const title = h('h1', {});
  const input = h('input', {
    type: 'search', autocomplete: 'off',
    oninput: (e) => { query = e.target.value; clearTimeout(timer); timer = setTimeout(render, 120); }
  });
  let timer = 0;
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': tr('Genres', 'Genres') });
  const grid = h('div', { class: 'grid' });
  const message = h('div', {});
  const root = h('section', { class: 'view', 'aria-label': tr('Zenders', 'Stations') },
    title,
    h('label', { class: 'search' }, icon('search', 20), input),
    chips, message, grid);

  let lastSignature = '';

  function renderChips() {
    const counts = genreCounts();
    const top = showAllGenres ? counts : counts.slice(0, 10);
    const chip = (name, label = name) =>
      h('button', { class: `chip${genre === name ? ' on' : ''}`, type: 'button', 'aria-pressed': String(genre === name), onclick: () => { genre = name; render(true); } }, label);
    replace(
      chips,
      chip('Alles', tr('Alles', 'All')),
      chip('Favorieten', tr('Favorieten', 'Favorites')),
      top.map((g) => chip(g.name)),
      counts.length > 10 ? h('button', { class: 'chip', type: 'button', onclick: () => { showAllGenres = !showAllGenres; render(true); } }, showAllGenres ? tr('Minder', 'Less') : tr(`Meer… (${counts.length - 10})`, `More… (${counts.length - 10})`)) : null
    );
  }

  function card(station) {
    const selected = station.id === state.currentId;
    const active = selected && (state.status === 'playing' || state.status === 'loading');
    const favorite = state.favorites.has(station.id);
    return h('div', { class: 'cardwrap' },
      h('button', {
        class: `sc${selected ? ' now' : ''}`, type: 'button', 'aria-label': tr(`Speel ${station.name}`, `Play ${station.name}`), 'aria-current': selected ? 'true' : null,
        onclick: () => play(station.id)
      },
      active ? h('span', { class: 'badge' }, tr('Speelt nu', 'Playing')) : null,
      logoImage(station),
      h('div', { class: 'info' }, h('div', { class: 'n' }, station.name), h('div', { class: 'g' }, station.genres.join(' · ')))),
      h('button', {
        class: `fav${favorite ? ' on' : ''}`, type: 'button', 'aria-pressed': String(favorite),
        'aria-label': favorite ? tr(`${station.name} verwijderen uit favorieten`, `Remove ${station.name} from favorites`) : tr(`${station.name} toevoegen aan favorieten`, `Add ${station.name} to favorites`),
        onclick: () => toggleFavorite(station.id)
      }, icon('heart', 20)));
  }

  function render(force = false) {
    const visible = state.stations.filter(matches);
    const active = state.status === 'playing' || state.status === 'loading';
    const signature = [tr('nl', 'en'), state.stations.length, state.updatedAt, genre, query, showAllGenres, [...state.favorites].join(), state.currentId, active, state.loading, state.loadError].join('|');
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    title.textContent = state.stations.length ? tr(`Zenders (${visible.length})`, `Stations (${visible.length})`) : tr('Zenders', 'Stations');
    input.placeholder = tr('Zoek op station of genre…', 'Search by station or genre…');
    input.setAttribute('aria-label', tr('Zoek op station of genre', 'Search by station or genre'));
    root.setAttribute('aria-label', tr('Zenders', 'Stations'));
    renderChips();
    if (state.loading && state.stations.length === 0) {
      replace(message, h('div', { class: 'empty' }, tr('Zenders laden…', 'Loading stations…')));
    } else if (state.stations.length === 0) {
      replace(message, h('div', { class: 'note bad' }, state.loadError || tr('De zenderlijst is leeg.', 'The station list is empty.')),
        h('button', { class: 'btn', type: 'button', onclick: () => document.dispatchEvent(new CustomEvent('ew:reload')) }, tr('Opnieuw proberen', 'Try again')));
    } else if (visible.length === 0) {
      replace(message, h('div', { class: 'empty' }, genre === 'Favorieten' ? tr('Je hebt nog geen favorieten. Tik op het hartje bij een zender.', 'You have no favorites yet. Tap the heart next to a station.') : tr('Geen zenders gevonden.', 'No stations found.')));
    } else {
      replace(message, state.loadError ? h('div', { class: 'note' }, tr(`De lijst kon niet worden vernieuwd (${state.loadError}). De laatste bekende lijst wordt getoond.`, `The list could not be refreshed (${state.loadError}). The last known list is shown.`)) : null);
    }
    replace(grid, visible.map(card));
  }

  subscribe(() => render());
  render(true);
  return { el: root, enter() { render(true); } };
}
