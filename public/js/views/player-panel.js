// Het spelerpaneel (rechts op een groot scherm, eigen pagina op een telefoon) en de mini-speler.
import { h, icon, logoImage, replace } from '../dom.js';
import { state, subscribe, currentStation, activeSlogans, DIM_DELAY_SECONDS, DIM_LEVEL } from '../state.js';
import { toggle, step, setVolume, getLevels, resume } from '../player.js';
import { AmigaRenderer, loadFonts, scrollText } from '../visualizer.js';
import { tr } from '../i18n.js';
import { BRAND } from '../brand.js';

let renderer = null;
let fontsFailed = false;
const startTime = performance.now();

function statusText() {
  switch (state.status) {
    case 'playing': return ['on', tr('Live · via de container', 'Live · via the container')];
    case 'loading': return ['wait', tr('Verbinden…', 'Connecting…')];
    case 'error': return ['err', tr('Gestopt', 'Stopped')];
    case 'paused': return ['', tr('Gepauzeerd', 'Paused')];
    default: return ['', currentStation() ? tr('Tik op afspelen', 'Tap play') : tr('Kies een zender', 'Choose a station')];
  }
}

/** De hoes op het hele scherm (tik of Escape om te sluiten). */
function openFullScreen(art) {
  const previous = document.activeElement;
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    previous?.focus?.();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  };
  const overlay = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('Hoes', 'Cover art'), onclick: close },
    h('img', { src: art.url, alt: '', style: 'object-position:50% 30%' }),
    h('button', { class: 'btn sm', type: 'button', 'aria-label': tr('Sluiten', 'Close'), onclick: close }, icon('close', 16)));
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  overlay.querySelector('button').focus();
}

export function createPlayerPanel() {
  const dimLayer = h('div', { class: 'dim' });
  const visWrap = h('div', { class: 'vis-wrap', 'aria-hidden': 'true' });
  const visBox = h('div', { class: 'vis-box' }, visWrap, dimLayer);
  const name = h('div', { class: 'pn' });
  const artist = h('div', { class: 'pa' });
  const coverButton = h('button', { class: 'pcover', type: 'button', hidden: true, onclick: () => state.art && openFullScreen(state.art) });
  const now = h('div', { class: 'np' }, coverButton, h('div', { class: 'npt' }, name, artist));
  const prev = h('button', { class: 'b', type: 'button', onclick: () => step(-1) }, icon('prev', 30));
  const next = h('button', { class: 'b', type: 'button', onclick: () => step(1) }, icon('next', 30));
  const big = h('button', { class: 'big', type: 'button', onclick: toggle });
  const volume = h('input', {
    type: 'range', min: '0', max: '100', step: '1',
    oninput: (e) => { setVolume(Number(e.target.value) / 100); fillRange(e.target); }
  });
  const volumeText = h('output', {}, '');
  const dot = h('span', { class: 'dot' });
  const liveText = h('span', {});
  const tag = h('span', { class: 'tag2' }, 'stream-proxy');
  const errorBox = h('div', { class: 'err-box', hidden: true });
  const hint = h('div', { class: 'hint' });

  const panel = h('aside', { class: 'pp' },
    visBox, now,
    h('div', { class: 'ctl' }, prev, big, next),
    h('div', { class: 'vol' }, icon('vol', 22), volume, volumeText),
    h('div', { class: 'live' }, dot, liveText, tag),
    errorBox, hint);

  const stillLogo = { id: null, node: null };
  let shownCover = null;

  function fillRange(input) {
    input.style.setProperty('--fill', `${input.value}%`);
    volumeText.textContent = `${input.value}%`;
  }

  /** De hoes in de speler: een vierkantje naast de tekst (of erboven), met het logo van de zender als badge. */
  function renderCover(station) {
    const art = state.vis.coverInPlayer && station ? state.art : null;
    now.dataset.pos = state.vis.coverPosition;
    coverButton.hidden = !art;
    if (!art) {
      shownCover = null;
      return;
    }
    if (shownCover !== art) {
      shownCover = art;
      replace(coverButton,
        h('img', { src: art.url, alt: '' }),
        station.logo ? h('span', { class: 'badge-logo' }, logoImage(station, 'logo', { small: true })) : null);
    }
    coverButton.setAttribute('aria-label', tr('Hoes op het hele scherm tonen', 'Show the cover full screen'));
  }

  function applyOptions() {
    if (!renderer) return;
    const vis = state.vis;
    renderer.setOptions({
      copperMode: vis.copperMode, sparkling: vis.sparkling, eqSensitivity: vis.eqSensitivity,
      showCover: vis.cover, coverSize: vis.coverSize, coverPosition: vis.coverPosition,
      slogans: activeSlogans()
    });
  }

  function render() {
    const station = currentStation();
    panel.setAttribute('aria-label', tr('Speler', 'Player'));
    prev.setAttribute('aria-label', tr('Vorige zender', 'Previous station'));
    next.setAttribute('aria-label', tr('Volgende zender', 'Next station'));
    volume.setAttribute('aria-label', tr('Volume', 'Volume'));
    hint.textContent = tr('Spatiebalk = pauze · ←/→ = vorige/volgende zender', 'Space = pause · ←/→ = previous/next station');
    name.textContent = station ? station.name : BRAND.name;
    artist.textContent = station
      ? (state.title ? state.title : tr('Live radio uitzending', 'Live radio broadcast'))
      : tr('Geen zender actief', 'No station active');
    const playing = state.status === 'playing' || state.status === 'loading';
    big.replaceChildren(icon(playing ? 'pause' : 'play', 34));
    big.setAttribute('aria-label', playing ? tr('Pauze', 'Pause') : tr('Afspelen', 'Play'));
    const [cls, text] = statusText();
    dot.className = `dot ${cls}`;
    liveText.textContent = text;
    tag.hidden = state.status !== 'playing';
    if (document.activeElement !== volume) {
      volume.value = String(Math.round(state.volume * 100));
      fillRange(volume);
    }
    if (state.status === 'error') {
      replace(errorBox, h('span', {}, state.error), h('button', { class: 'btn sm', type: 'button', onclick: resume }, tr('Opnieuw', 'Retry')));
      errorBox.hidden = false;
    } else {
      errorBox.hidden = true;
    }
    renderCover(station);
    applyOptions();
    // zonder visualizer (of zonder lettertypes): het logo van de zender
    const useStill = !state.visualizer || fontsFailed;
    if (useStill) {
      if (stillLogo.id !== (station?.id ?? '')) {
        stillLogo.id = station?.id ?? '';
        stillLogo.node = h('div', { class: 'still' }, station ? logoImage(station, 'logo') : h('img', { src: '/icons/icon-192.png', alt: '', style: 'border-radius:10px' }));
      }
      if (visWrap.firstChild !== stillLogo.node) replace(visWrap, stillLogo.node);
    } else if (renderer && visWrap.firstChild !== renderer.canvas) {
      replace(visWrap, renderer.canvas);
    }
  }

  loadFonts()
    .then((fonts) => {
      renderer = new AmigaRenderer(fonts);
      render();
      requestAnimationFrame(frame);
    })
    .catch(() => {
      fontsFailed = true;
      render();
    });

  // Dimmen: na DIM_DELAY_SECONDS zonder aanraking, beweging of toets zakt de helderheid van de visualizer naar DIM_LEVEL.
  let lastActivity = performance.now();
  let dimmed = false;
  const wake = () => {
    lastActivity = performance.now();
    if (dimmed) setDimmed(false);
  };
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel']) document.addEventListener(type, wake, { passive: true });
  function setDimmed(on) {
    dimmed = on;
    dimLayer.style.opacity = on ? String(1 - DIM_LEVEL) : '0';
  }
  function checkDim() {
    const idle = (performance.now() - lastActivity) / 1000 >= DIM_DELAY_SECONDS;
    const want = state.vis.dim && state.visualizer && !fontsFailed && state.status === 'playing' && !document.hidden && idle;
    if (want !== dimmed) setDimmed(want);
  }

  function frame() {
    requestAnimationFrame(frame);
    checkDim();
    if (!renderer || !state.visualizer || document.hidden || panel.offsetParent === null) return;
    const t = (performance.now() - startTime) / 1000;
    const station = currentStation();
    const playing = state.status === 'playing';
    const levels = getLevels(t);
    renderer.setCover(state.vis.cover && state.art ? state.art.image : null);
    renderer.render(
      t,
      station ? station.name : BRAND.name,
      station ? scrollText(state.title) : tr('Geen zender actief', 'No station active'),
      playing ? levels : null,
      playing
    );
  }

  subscribe(render);
  render();
  return panel;
}

export function createMiniPlayer(onOpen) {
  const body = h('div', { class: 'mini' });
  const button = h('button', { class: 'pp-btn', type: 'button', onclick: (e) => { e.stopPropagation(); toggle(); } });

  function render() {
    const station = currentStation();
    document.body.classList.toggle('has-station', Boolean(station));
    if (!station) return;
    const playing = state.status === 'playing' || state.status === 'loading';
    button.replaceChildren(icon(playing ? 'pause' : 'play', 28));
    button.setAttribute('aria-label', playing ? tr('Pauze', 'Pause') : tr('Afspelen', 'Play'));
    replace(
      body,
      h('button', { class: 'open', type: 'button', style: 'display:flex;align-items:center;gap:10px;flex:1;min-width:0;text-align:left', onclick: onOpen },
        logoImage(station, 'logo', { small: true }),
        h('span', { class: 't' }, h('b', {}, station.name), h('span', {}, state.title || (state.status === 'error' ? tr('Gestopt', 'Stopped') : tr('Live radio uitzending', 'Live radio broadcast'))))),
      button
    );
  }
  subscribe(render);
  render();
  return body;
}
