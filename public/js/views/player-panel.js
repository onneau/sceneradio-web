// De speler: de visualizer vult de hele pagina, met de bediening erover (die na een tijdje verdwijnt), en de mini-speler.
import { h, icon, logoImage, replace } from '../dom.js';
import { state, subscribe, currentStation, activeSlogans, DIM_DELAY_SECONDS, DIM_LEVEL } from '../state.js';
import { toggle, step, setVolume, getLevels, resume } from '../player.js';
import { AmigaRenderer, loadFonts, logicalSize, scrollText } from '../visualizer.js';
import { tr } from '../i18n.js';
import { BRAND } from '../brand.js';
import { onActivity } from '../activity.js';

let renderer = null;
let fontsFailed = false;
const startTime = performance.now();
const HUD_HIDE_SECONDS = 8; // de bediening verdwijnt na zoveel seconden zonder beweging, tik of toets

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
  const dot = h('span', { class: 'dot' });
  const artist = h('span', {});
  const coverButton = h('button', { class: 'pcover', type: 'button', hidden: true, onclick: () => state.art && openFullScreen(state.art) });
  const now = h('div', { class: 'np' }, coverButton, h('div', { class: 'npt' }, name, h('div', { class: 'pa' }, dot, artist)));
  const prev = h('button', { class: 'b', type: 'button', onclick: () => step(-1) }, icon('prev', 30));
  const next = h('button', { class: 'b', type: 'button', onclick: () => step(1) }, icon('next', 30));
  const big = h('button', { class: 'big', type: 'button', onclick: toggle });
  const volume = h('input', {
    type: 'range', min: '0', max: '100', step: '1',
    oninput: (e) => { setVolume(Number(e.target.value) / 100); fillRange(e.target); }
  });
  const volumeText = h('output', {}, '');
  const errorBox = h('div', { class: 'err-box', hidden: true });
  const menuButton = h('button', { class: 'hud-btn menu', type: 'button', onclick: () => { location.hash = 'zenders'; } }, icon('menu', 26));
  const fullButton = h('button', { class: 'hud-btn fs', type: 'button', hidden: !document.fullscreenEnabled, onclick: toggleFullScreen }, icon('fullscreen', 24));
  const choose = h('button', { class: 'btn f cta', type: 'button', onclick: () => { location.hash = 'zenders'; } });
  const hint = h('div', { class: 'hud-hint' });
  const bottom = h('div', { class: 'hud-bottom' },
    errorBox,
    h('div', { class: 'bar2' }, now, h('div', { class: 'ctl' }, prev, big, next), h('div', { class: 'vol' }, icon('vol', 22), volume, volumeText)));

  // De bediening ligt over het beeld en verdwijnt na HUD_HIDE_SECONDS zonder beweging, tik of toets (alleen tijdens het spelen).
  const hud = h('div', { class: 'hud' }, menuButton, fullButton, hint, choose, bottom);
  const panel = h('aside', { class: 'pp' }, visBox, hud);

  const stillLogo = { id: null, node: null };
  let shownCover = null;

  function fillRange(input) {
    input.style.setProperty('--fill', `${input.value}%`);
    volumeText.textContent = `${input.value}%`;
  }

  function toggleFullScreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => {
    fullButton.replaceChildren(icon(document.fullscreenElement ? 'fullscreenExit' : 'fullscreen', 24));
    render();
  });
  document.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.key === 'f' || event.key === 'F') && panel.offsetParent !== null) toggleFullScreen();
  });

  let hudTimer = 0;
  let holding = false;   // een vinger of muisknop is omlaag op de bediening (bijvoorbeeld het volume verschuiven)
  /** Alleen terwijl er muziek speelt (of verbonden wordt) verdwijnt de bediening; bij pauze of een storing blijft ze staan. */
  const hideable = () => state.status === 'playing' || state.status === 'loading';
  let lastHideable = false;
  function hideHud() {
    if (holding || !hideable()) return;   // zodra de vinger loslaat of de muziek weer speelt, start wakeHud de tijd opnieuw
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    panel.classList.add('hud-off');
  }
  function wakeHud() {
    panel.classList.remove('hud-off');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(hideHud, HUD_HIDE_SECONDS * 1000);
  }
  // Aankomen op de speler (zender gekozen, terug uit een menu): de bediening laten zien en de tijd opnieuw starten.
  new MutationObserver(() => { if (document.body.dataset.view === 'speler') wakeHud(); })
    .observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
  hud.addEventListener('pointerdown', () => { holding = true; });
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, () => { if (holding) { holding = false; wakeHud(); } });

  /** De hoes in de speler: een vierkantje naast de tekst, met het logo van de zender als badge. */
  function renderCover(station) {
    const art = state.vis.coverInPlayer && station ? state.art : null;
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

  /** Het beeld krijgt de verhouding van het scherm, zodat het alles vult zonder uit te rekken. */
  function fit() {
    const width = visWrap.clientWidth;
    const height = visWrap.clientHeight;
    if (!renderer || !width || !height) return;
    const size = logicalSize(width / height);
    renderer.resize(size.width, size.height);
  }
  new ResizeObserver(fit).observe(visWrap);

  function render() {
    const station = currentStation();
    panel.setAttribute('aria-label', tr('Speler', 'Player'));
    menuButton.setAttribute('aria-label', tr('Menu: zenders en instellingen', 'Menu: stations and settings'));
    fullButton.setAttribute('aria-label', document.fullscreenElement ? tr('Volledig scherm verlaten', 'Exit full screen') : tr('Volledig scherm', 'Full screen'));
    prev.setAttribute('aria-label', tr('Vorige zender', 'Previous station'));
    next.setAttribute('aria-label', tr('Volgende zender', 'Next station'));
    volume.setAttribute('aria-label', tr('Volume', 'Volume'));
    hint.textContent = tr('Spatiebalk = pauze · ←/→ = vorige/volgende zender · F = volledig scherm', 'Space = pause · ←/→ = previous/next station · F = full screen');
    choose.textContent = tr('Kies een zender', 'Choose a station');
    choose.hidden = Boolean(station);
    name.textContent = station ? station.name : BRAND.name;
    const [cls, text] = statusText();
    dot.className = `dot ${cls}`;
    artist.textContent = state.status === 'playing' ? (state.title || tr('Live radio uitzending', 'Live radio broadcast')) : text;
    const playing = state.status === 'playing' || state.status === 'loading';
    big.replaceChildren(icon(playing ? 'pause' : 'play', 34));
    big.setAttribute('aria-label', playing ? tr('Pauze', 'Pause') : tr('Afspelen', 'Play'));
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
    if (hideable() !== lastHideable) {   // gaat spelen, of stopt: de bediening laten zien en de tijd opnieuw starten
      lastHideable = hideable();
      wakeHud();
    }
    if (!hideable()) panel.classList.remove('hud-off');
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
      const width = visWrap.clientWidth;
      const height = visWrap.clientHeight;
      renderer = new AmigaRenderer(fonts, undefined, width && height ? logicalSize(width / height) : undefined);
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
  onActivity(() => {
    lastActivity = performance.now();
    if (dimmed) setDimmed(false);
    if (panel.offsetParent !== null) wakeHud();
  });
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
