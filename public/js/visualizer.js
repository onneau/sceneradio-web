// De Amiga-visualizer van de app (AmigaVisualizer.kt en SpectrumAudioProcessor.kt), opnieuw gemaakt voor de browser.
// Alles wordt in lage resolutie getekend (256 regels hoog, zoals een Amiga PAL-scherm) en daarna scherp
// (zonder uitsmeren) naar het scherm opgeschaald.
import { tr } from './i18n.js';

const LOGICAL_HEIGHT = 256;
const LOGICAL_WIDTH = 455; // 16:9
const COPPER_HEIGHT = 70;
const COPPER_BARS = 6;          // zes balken draaien om elkaar heen
const COPPER_THICKNESS = 16;    // regels per balk
const COPPER_ORBIT = 25;        // hoever het midden van een balk boven en onder het midden van de koperzone komt
const TITLE_TOP = 12;
const SLOGAN_TOP = 56;
const SCROLLER_CENTER = 106;
const WAVE_AMPLITUDE = 14;
const EQ_BLOCK_HEIGHT = 3;
const EQ_OVERLAP = 1;
const REFLECTION_ROWS = 30;
const REFLECTION_FADE_POWER = 1.4;
const SLOGAN_SCALE_PER_PX = 0.375 / 11;
const SCROLL_MIN_SCALE = 0.3;
const WAVE_LENGTH_DIVISOR = 1.6;
const EQ_STEPS = 16;            // kleurstappen van onder naar boven in de equalizer
const EQ_ALPHA_BOTTOM = 0.45;   // de equalizer staat vaag op de achtergrond: onderin 45 %, bovenin 30 %
const EQ_ALPHA_TOP = 0.30;
const EQ_TOP_GAP = 16;          // de equalizer begint zoveel regels onder de slogan, dus achter de scroller
const TITLE_SWING_SPEED = 0.5;  // de zendernaam doet er 1 / dit keer zo lang over als de oude fata morgana
const TITLE_LEAN = 2.571;       // beeldpunten waarmee boven en onder tegengesteld bewegen, per beeldpunt van hazeAmplitude
const TITLE_SWAY = 2.286;       // beeldpunten waarmee de hele naam heen en weer zwiert, per beeldpunt van hazeAmplitude

// Hoes en sterren (zoals AmigaVisualizer.kt)
const COVER_SIZES = { small: 44, medium: 62, large: 84 };
const COVER_GAP = 4;              // lege regels tussen het spiegelbeeld van de scroller en een grote hoes
const COVER_BOTTOM_MARGIN = 4;    // en onderaan (ruimte voor de schaduw)
const COVER_LEFT_MARGIN = 14;     // een hoes die links of rechts staat (en een grote hoes) staat zoveel beeldpunten van de rand
const COVER_FADE_SECONDS = 0.6;   // zo lang duurt het in- en uitfaden van de hoes
const EQ_FLOOR_BASE = 0.65;       // echte meting: onder dit niveau (bij gevoeligheid 100 %) blijft de balk leeg ...
const EQ_FLOOR_SPREAD = 0.5;      // ... en de gevoeligheid verschuift die drempel met zoveel per 100 %
const EQ_TOP = 0.95;              // ... boven dit niveau staat de balk vol
const EQ_GAMMA = 1.2;             // > 1: rustiger onderin, pieken springen er beter uit
const GLINT_CORE = '#FFFFFF';
const GLINT_RAY = '#B9D0FF';
const GLINT_DIAGONAL = '#DBE7FF';
const COPPER_DRIFT_RANGE = 12;    // subtiel: uitslag in graden (±)
const COPPER_DRIFT_SECONDS = 60;  // subtiel: duur van een heel rondje
const COPPER_CYCLE_SECONDS = 60;  // alle kleuren: duur van een heel rondje door de regenboog

/** Wat de instellingen van de pagina de tekenaar meegeven (zie state.vis en de sloganlijst). */
export const RENDER_DEFAULTS = {
  copperMode: 'off', sparkling: true, eqSensitivity: 1,
  showCover: false, coverSize: 'small', coverPosition: 'default',
  slogans: []
};

export const DEFAULT_SETTINGS = {
  waveSpeed: 2.2, copperSpeed: 2.0, hazeSpeed: 2.0, starSpeed: 1.0,
  titleScale: 1.2, scrollerRatio: 0.75, sloganPx: 11, hazeAmplitude: 3.5,
  copperHue: 0, equalizerHue: 0, backgroundHue: 0
};
const MAX_TITLE_SCALE = 1.6;
const MAX_SLOGAN_PX = 16;

const hex = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const AMIGA = {
  BLACK: hex(0x000014), BLUE: hex(0x0033CC), LBLUE: hex(0x3377FF), WHITE: [255, 255, 255],
  // Equalizer: zonsondergang van onderin oranje via roze en paars naar donkerblauw bovenin (positie 0..1).
  EQ_STOPS: [[0, hex(0xFF8A1E)], [0.35, hex(0xF2475A)], [0.65, hex(0x9B3BA6)], [1, hex(0x1E3AA0)]],
  GOLD: [0xFFF3B0, 0xFFE070, 0xFFC22E, 0xE0A020, 0xB87818, 0x8A5410, 0x5A3208].map(hex),
  COPPER: [0xFFD2A8, 0xF0A070, 0xD07838, 0xB05A22, 0x8A4012, 0x62290A, 0x3C1606].map(hex)
};

/** Kleur op positie p (0..1) tussen de steunkleuren van een verloop. */
function gradientColor(stops, p) {
  let k = 0;
  while (k < stops.length - 2 && p > stops[k + 1][0]) k++;
  const [p0, c0] = stops[k];
  const [p1, c1] = stops[k + 1];
  const f = Math.min(1, Math.max(0, (p - p0) / (p1 - p0)));
  return c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
}

/** Kleur met gedraaide tint (graden). Grijs en wit blijven wat ze zijn. */
function shiftHue([r, g, b], degrees) {
  if (degrees === 0) return [r, g, b];
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf), d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === rf) hue = ((gf - bf) / d) % 6;
    else if (max === gf) hue = (bf - rf) / d + 2;
    else hue = (rf - gf) / d + 4;
    hue *= 60;
  }
  const sat = max === 0 ? 0 : d / max;
  hue = (((hue + degrees) % 360) + 360) % 360;
  const c = max * sat, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = max - c;
  const [r1, g1, b1] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

const css = ([r, g, b]) => `rgb(${r},${g},${b})`;

class Palette {
  constructor(s) {
    this.background = css(shiftHue(AMIGA.BLACK, s.backgroundHue));
    this.starDark = css(shiftHue(AMIGA.BLUE, s.backgroundHue));
    this.starLight = css(shiftHue(AMIGA.LBLUE, s.backgroundHue));
    this.starWhite = css(AMIGA.WHITE);
    this.equalizer = Array.from({ length: EQ_STEPS }, (_, i) => {
      const p = i / (EQ_STEPS - 1);
      const [r, g, b] = shiftHue(gradientColor(AMIGA.EQ_STOPS, p), s.equalizerHue);
      const alpha = EQ_ALPHA_BOTTOM + (EQ_ALPHA_TOP - EQ_ALPHA_BOTTOM) * p;
      return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    });
    this.gold = AMIGA.GOLD.map((c) => css(shiftHue(c, s.copperHue)));
    this.copper = AMIGA.COPPER.map((c) => css(shiftHue(c, s.copperHue)));
    this.glow = Array.from({ length: COPPER_HEIGHT }, (_, row) => {
      const strength = 1 - Math.abs(row / COPPER_HEIGHT - 0.55) * 1.2;
      const red = Math.trunc(0x2A * strength) + 6;
      const green = Math.trunc(0x12 * strength) + 3;
      const blue = Math.trunc(0x05 * strength) + 4;
      return css(shiftHue([red, green, blue], s.copperHue));
    });
  }
}

// Een koperbalk is een rond buisje: per regel de kleurindex uit de GOLD/COPPER-reeks (0 = lichtst, 6 = donkerst),
// licht in het midden en donker aan de randen.
const BAR_PROFILE = Array.from({ length: COPPER_THICKNESS }, (_, i) =>
  Math.round(Math.pow(Math.abs((i + 0.5) / COPPER_THICKNESS - 0.5) * 2, 1.25) * 6));
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

const FALLBACKS = { '&': '+', '/': '-', '\\': '-', '_': '-', '|': ':', '[': '(', ']': ')', '{': '(', '}': ')', '*': '+', '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '.' };

/** Hoofdletters, zonder accenten, met vervangers voor tekens die de lettertypes niet hebben. */
function fontText(raw) {
  const plain = String(raw).normalize('NFD').replace(/\p{M}+/gu, '');
  let out = '';
  for (const c of plain.toUpperCase()) out += FALLBACKS[c] ?? c;
  return out;
}

const round = (v) => Math.round(v);

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

/** Een Amiga-kleurenfont als PNG-spritesheet (16 x 16 tekens, rij * 16 + kolom = teken). */
class PixelFont {
  constructor(image, cellWidth, cellHeight) {
    this.cellWidth = cellWidth;
    this.cellHeight = cellHeight;
    this.left = new Int32Array(256);
    this.ink = new Int32Array(256);
    this.glyphHeight = 0;
    this.spaceWidth = round(cellWidth * 0.45);
    const { canvas, ctx } = makeCanvas(image.width, image.height);
    ctx.drawImage(image, 0, 0);
    this.sheets = { normal: canvas };
    const w = image.width;
    const pixels = ctx.getImageData(0, 0, w, image.height).data;
    for (let code = 0; code < 256; code++) {
      const ox = (code % 16) * cellWidth;
      const oy = Math.floor(code / 16) * cellHeight;
      if (ox + cellWidth > w || oy + cellHeight > image.height) continue;
      let minX = cellWidth, maxX = -1, maxY = -1;
      for (let y = 0; y < cellHeight; y++) {
        for (let x = 0; x < cellWidth; x++) {
          if (pixels[((oy + y) * w + ox + x) * 4 + 3] !== 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= 0) {
        this.left[code] = minX;
        this.ink[code] = maxX - minX + 1;
        if (maxY + 1 > this.glyphHeight) this.glyphHeight = maxY + 1;
      }
    }
  }

  /** Een variant van het font: 'silhouet' (één kleur, zoals LightingColorFilter(0, kleur)) of 'half' (kleuren x 0.5). */
  sheet(kind, color) {
    const key = kind + (color ? color.join(',') : '');
    if (this.sheets[key]) return this.sheets[key];
    const source = this.sheets.normal;
    const { canvas, ctx } = makeCanvas(source.width, source.height);
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, source.width, source.height);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      if (kind === 'silhouet') { d[i] = color[0]; d[i + 1] = color[1]; d[i + 2] = color[2]; }
      else { d[i] = Math.trunc(d[i] * 128 / 255); d[i + 1] = Math.trunc(d[i + 1] * 128 / 255); d[i + 2] = Math.trunc(d[i + 2] * 128 / 255); }
    }
    ctx.putImageData(image, 0, 0);
    this.sheets[key] = canvas;
    return canvas;
  }

  has(ch) {
    const code = ch.codePointAt(0);
    return code < 256 && this.ink[code] > 0;
  }

  advance(ch, scale = 1) {
    if (ch === ' ' || !this.has(ch)) return round(this.spaceWidth * scale);
    return round(this.ink[ch.codePointAt(0)] * scale) + round(2 * scale);
  }

  width(text, scale = 1) {
    let total = 0;
    for (const ch of text) total += this.advance(ch, scale);
    return total;
  }

  draw(ctx, ch, x, y, scale, sheet = this.sheets.normal) {
    if (ch === ' ' || !this.has(ch)) return;
    const code = ch.codePointAt(0);
    const sx = (code % 16) * this.cellWidth + this.left[code];
    const sy = Math.floor(code / 16) * this.cellHeight;
    const dw = Math.max(1, round(this.ink[code] * scale));
    const dh = Math.max(1, round(this.glyphHeight * scale));
    ctx.drawImage(sheet, sx, sy, this.ink[code], this.glyphHeight, round(x), round(y), dw, dh);
  }

  drawText(ctx, text, x, y, scale, sheet) {
    let cx = x;
    for (const ch of text) {
      this.draw(ctx, ch, cx, y, scale, sheet);
      cx += this.advance(ch, scale);
    }
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Kon ${src} niet laden`));
    image.src = src;
  });
}

export async function loadFonts() {
  const [metallix, forest, scopex] = await Promise.all([
    loadImage('/fonts/metallix.png'), loadImage('/fonts/forest.png'), loadImage('/fonts/scopex.png')
  ]);
  return {
    metallix: new PixelFont(metallix, 36, 36), // scroller: artiest en titel
    forest: new PixelFont(forest, 25, 32),     // overige tekst
    scopex: new PixelFont(scopex, 32, 35)      // zendernaam
  };
}

/** De tijd van nu, alleen uren en minuten: "13:24" (24-uurs) of "1:24 PM" (12-uurs), met gewone cijfers en letters. */
export function clockText(date = new Date()) {
  const hour12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  if (!hour12) return `${String(date.getHours()).padStart(2, '0')}:${minutes}`;
  return `${date.getHours() % 12 || 12}:${minutes} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** Een slogan in het lettertype; {tijd} (ook {TIJD}) wordt de tijd van nu. */
export function resolveSlogan(source, date = new Date()) {
  return fontText(String(source).replace(/\{tijd\}/gi, () => clockText(date)));
}

// Een pseudo-toevalsgenerator met vaste zaadwaarde, zodat de sterren er elke keer hetzelfde uitzien.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * De hoes als Amiga-plaatje: vierkant bijgesneden (bij een staand plaatje iets boven het midden, waar meestal het gezicht
 * staat), in halve stappen verkleind (een nette gemiddelde, zodat een grote hoes niet gaat flikkeren) en naar 16 niveaus per
 * kleur teruggebracht met een geordend dither-patroon. Geeft een canvas van size x size.
 */
export function amigaCover(image, size) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const side = Math.max(1, Math.min(width, height));
  let source = image;
  let sx = (width - side) / 2;
  let sy = (height - side) * 0.3;
  let span = side;
  while (span / 2 >= size) {
    const half = Math.floor(span / 2);
    const step = makeCanvas(half, half);
    step.ctx.imageSmoothingEnabled = true;
    step.ctx.imageSmoothingQuality = 'high';
    step.ctx.drawImage(source, sx, sy, span, span, 0, 0, half, half);
    source = step.canvas;
    sx = 0;
    sy = 0;
    span = half;
  }
  const out = makeCanvas(size, size);
  out.ctx.imageSmoothingEnabled = true;
  out.ctx.imageSmoothingQuality = 'high';
  out.ctx.drawImage(source, sx, sy, span, span, 0, 0, size, size);
  const picture = out.ctx.getImageData(0, 0, size, size);
  const d = picture.data;
  const quantize = (v) => Math.min(15, Math.max(0, Math.round(v / 17))) * 17;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const shift = (BAYER[(y & 3) * 4 + (x & 3)] - 0.5) * 16;
      d[i] = quantize(d[i] + shift);
      d[i + 1] = quantize(d[i + 1] + shift);
      d[i + 2] = quantize(d[i + 2] + shift);
      d[i + 3] = 255;
    }
  }
  out.ctx.putImageData(picture, 0, 0);
  return out.canvas;
}

export class AmigaRenderer {
  constructor(fonts, settings = DEFAULT_SETTINGS) {
    this.fonts = fonts;
    this.width = LOGICAL_WIDTH;
    this.height = LOGICAL_HEIGHT;
    this.cfg = { ...settings };
    this.palette = new Palette(this.cfg);

    const main = makeCanvas(this.width, this.height);
    this.canvas = main.canvas;
    this.ctx = main.ctx;

    const titleHeight = Math.round(fonts.scopex.glyphHeight * MAX_TITLE_SCALE) + 3;
    const title = makeCanvas(this.width, titleHeight);
    this.titleCanvas = title.canvas;
    this.titleCtx = title.ctx;
    this.titleHeight = titleHeight;
    this.titleSource = '\u0000';
    this.titleGlyphHeight = titleHeight;

    this.scrollerFont = fonts.metallix;
    this.scrollScale = this.cfg.titleScale * this.cfg.scrollerRatio;
    this.scrollGlyphHeight = 0;
    this.scrollTop = 0;
    this.reflectionAxis = 0;
    const reflection = makeCanvas(this.width, REFLECTION_ROWS);
    this.reflectionCanvas = reflection.canvas;
    this.reflectionCtx = reflection.ctx;
    this.scrollSource = '\u0000';
    this.scrollChars = [];
    this.scrollOffsets = [];
    this.scrollTotal = 0;

    this.sloganScale = this.cfg.sloganPx * SLOGAN_SCALE_PER_PX;
    this.sloganHeight = Math.round(fonts.forest.glyphHeight * this.sloganScale) + 2;
    this.sloganTop = SLOGAN_TOP;
    const sloganMax = Math.round(fonts.forest.glyphHeight * MAX_SLOGAN_PX * SLOGAN_SCALE_PER_PX) + 2;
    const slogan = makeCanvas(this.width, sloganMax);
    this.sloganCanvas = slogan.canvas;
    this.sloganCtx = slogan.ctx;

    this.opts = { ...RENDER_DEFAULTS };
    this.copperDriftPhase = 0;
    this.paletteCopperHue = this.cfg.copperHue;
    this.sloganList = [];
    this.sloganPeriod = -1;
    this.sloganText = '';
    this.coverSource = null;
    this.coverCanvas = null;
    this.coverCanvasSize = 0;
    this.coverFade = 0;

    this.starCount = 70;
    const random = mulberry32(1990);
    const starSpace = this.height - COPPER_HEIGHT;
    this.starX = []; this.starY = []; this.starLayer = [];
    for (let i = 0; i < this.starCount; i++) {
      this.starX.push(random() * this.width);
      this.starY.push(random() * starSpace);
      this.starLayer.push(Math.floor(random() * 3));
    }

    this.barCount = 32;
    this.barLevels = new Float32Array(this.barCount);
    this.lastTime = 0;
    this.lastRenderTime = 0;
    this.starTime = 0;
    this.wavePhase = 0;
    this.copperPhase = 0;
    this.hazePhase = 0;
    this.equalizerBottom = this.height - COPPER_HEIGHT + EQ_OVERLAP;
    this.equalizerTop = 0;
    this.maxBlocks = 1;
    this.layoutScroller(this.scrollScale);

    this.shadowFont = fonts.scopex.sheet('silhouet', [0x00, 0x0A, 0x2E]);
    this.scrollShadow = fonts.metallix.sheet('silhouet', [0x00, 0x20, 0x0C]);
    this.scrollHalf = fonts.metallix.sheet('half');
  }

  setSettings(next) {
    const old = this.cfg;
    this.cfg = { ...next };
    if (next.copperHue !== old.copperHue || next.equalizerHue !== old.equalizerHue || next.backgroundHue !== old.backgroundHue) {
      this.paletteCopperHue = this.effectiveCopperHue();
      this.palette = new Palette({ ...next, copperHue: this.paletteCopperHue });
    }
    this.sloganScale = next.sloganPx * SLOGAN_SCALE_PER_PX;
    this.sloganHeight = Math.round(this.fonts.forest.glyphHeight * this.sloganScale) + 2;
    this.titleSource = '\u0000';
  }

  /** De keuzes uit Instellingen > Weergave (koperkleur, sterren, equalizer, hoes) en de sloganlijst. */
  setOptions(next) {
    const old = this.opts;
    this.opts = { ...RENDER_DEFAULTS, ...next };
    if (this.opts.copperMode !== old.copperMode) {
      this.copperDriftPhase = 0;
      this.applyCopperHue();
    }
    if (this.opts.slogans !== old.slogans) {
      this.sloganList = this.opts.slogans.filter((s) => fontText(s).trim());
      this.sloganPeriod = -1;
    }
    if (this.opts.coverSize !== old.coverSize) this.coverCanvas = null;
  }

  /** De hoes (een geladen plaatje) of null. Een nieuwe hoes komt rustig binnen. */
  setCover(image) {
    if (image === this.coverSource) return;
    this.coverSource = image;
    this.coverCanvas = null;
    this.coverCanvasSize = 0;
    this.coverFade = 0;
  }

  // Koperkleur: vast (uit), heel langzaam heen en weer rond de ingestelde tint (subtiel) of rond door de hele regenboog.
  effectiveCopperHue() {
    const phase = this.copperDriftPhase;
    if (this.opts.copperMode === 'subtle') return this.cfg.copperHue + Math.round(COPPER_DRIFT_RANGE * Math.sin(2 * Math.PI * phase));
    if (this.opts.copperMode === 'all') return this.cfg.copperHue + Math.round(360 * phase);
    return this.cfg.copperHue;
  }

  applyCopperHue() {
    const hue = this.effectiveCopperHue();
    if (hue === this.paletteCopperHue) return;   // het palet verandert alleen als de tint echt een graad opschuift
    this.paletteCopperHue = hue;
    this.palette = new Palette({ ...this.cfg, copperHue: hue });
  }

  updateCopperDrift(dt) {
    if (this.opts.copperMode === 'off') return;
    const seconds = this.opts.copperMode === 'subtle' ? COPPER_DRIFT_SECONDS : COPPER_CYCLE_SECONDS;
    this.copperDriftPhase = (this.copperDriftPhase + dt / seconds) % 1;
    this.applyCopperHue();
  }

  /** Eén beeld tekenen. `levels` is een lijst van 0 tot 1 (of null voor een nagebootst ritme). */
  render(t, station, text, levels, playing) {
    const dt = Math.min(0.1, Math.max(0, t - this.lastRenderTime));
    this.lastRenderTime = t;
    this.starTime += dt * this.cfg.starSpeed;
    this.wavePhase += dt * this.cfg.waveSpeed;
    this.copperPhase += dt * this.cfg.copperSpeed;
    this.hazePhase += dt * this.cfg.hazeSpeed;
    this.updateCopperDrift(dt);

    this.setTitle(station);
    this.setScrollText(text);
    const ctx = this.ctx;
    ctx.fillStyle = this.palette.background;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawStars();
    this.drawEqualizer(t, levels, playing);
    this.drawSlogan(t);
    this.drawTitle();
    this.drawScroller(t);
    this.drawCopper();
    this.drawCover(dt);
  }

  setTitle(name) {
    if (name === this.titleSource) return;
    this.titleSource = name;
    const ctx = this.titleCtx;
    ctx.clearRect(0, 0, this.width, this.titleHeight);
    const font = this.fonts.scopex;
    // Aan de randen blijft ruimte over voor het hellen en schuiven van de naam.
    const reach = Math.ceil(this.cfg.hazeAmplitude * (TITLE_LEAN + TITLE_SWAY)) + 2;
    const limit = Math.min(this.width * 0.94, this.width - 2 * reach);
    let text = fontText(name);
    let scale = this.cfg.titleScale;
    while (font.width(text, scale) > limit && scale > 0.45) scale -= 0.05;
    while (font.width(text, scale) > limit && text.length > 1) text = text.slice(0, -1);
    const x = (this.width - font.width(text, scale)) / 2;
    font.drawText(ctx, text, x + 1, 1, scale, this.shadowFont);
    font.drawText(ctx, text, x, 0, scale);
    this.titleGlyphHeight = Math.round(font.glyphHeight * scale) + 1;
    this.sloganTop = Math.max(SLOGAN_TOP, TITLE_TOP + Math.round(font.glyphHeight * scale));
    this.layoutScroller(Math.max(SCROLL_MIN_SCALE, scale * this.cfg.scrollerRatio));
  }

  layoutScroller(scale) {
    this.scrollScale = scale;
    this.scrollGlyphHeight = Math.round(this.scrollerFont.glyphHeight * scale);
    this.scrollTop = Math.max(
      Math.round(SCROLLER_CENTER - this.scrollGlyphHeight / 2),
      this.sloganTop + this.sloganHeight + 3 + WAVE_AMPLITUDE
    );
    this.reflectionAxis = this.scrollTop + WAVE_AMPLITUDE + this.scrollGlyphHeight + 2;
    this.equalizerTop = this.sloganTop + this.sloganHeight + EQ_TOP_GAP;
    this.maxBlocks = Math.max(1, Math.trunc((this.equalizerBottom - this.equalizerTop) / EQ_BLOCK_HEIGHT));
    this.scrollOffsets = [];
    let x = 0;
    for (const ch of this.scrollChars) {
      this.scrollOffsets.push(x);
      x += this.scrollerFont.advance(ch, scale);
    }
    this.scrollTotal = x;
  }

  setScrollText(text) {
    if (text === this.scrollSource) return;
    this.scrollSource = text;
    this.scrollChars = [...`    ${fontText(text)}    `];
    this.layoutScroller(this.scrollScale);
  }

  drawStars() {
    const ctx = this.ctx;
    const sparkle = this.opts.sparkling;
    const clock = this.lastRenderTime;
    for (let i = 0; i < this.starCount; i++) {
      const layer = this.starLayer[i];
      const speed = 8 + layer * 14;
      const x = round((this.starX[i] + this.starTime * speed) % this.width);
      const y = round(this.starY[i]);
      ctx.fillStyle = layer === 0 ? this.palette.starDark : layer === 1 ? this.palette.starLight : this.palette.starWhite;
      if (sparkle && layer >= 1) {
        // Zacht flikkeren: de ster wordt wat helderder en dofer, elke ster in zijn eigen tempo.
        const wave = Math.sin(clock * (1.1 + (i % 5) * 0.37) + i * 1.7);
        ctx.globalAlpha = 0.55 + 0.45 * wave * wave;
      }
      ctx.fillRect(x, y, 1, 1);
      ctx.globalAlpha = 1;
      if (sparkle && i % 4 === 0) this.drawGlint(i, x, y, clock);
    }
  }

  // Af en toe fonkelt een ster: een kruisje van lichtstralen dat opkomt en weer wegvalt.
  drawGlint(index, x, y, clock) {
    const period = 2.4 + (index % 7) * 0.45;
    const duration = 0.6;
    const local = (clock + index * 0.77) % period;
    if (local >= duration) return;
    const k = Math.sin((Math.PI * local) / duration);   // 0 .. 1 .. 0
    const arm = 1 + Math.round(k * 5);
    const ctx = this.ctx;
    ctx.fillStyle = GLINT_CORE;
    ctx.fillRect(x, y, 1, 1);
    for (let a = 1; a <= arm; a++) {
      ctx.fillStyle = a === 1 ? GLINT_CORE : GLINT_RAY;
      ctx.globalAlpha = Math.min(1, Math.max(0.15, k * (1 - (a - 1) / (arm + 0.5))));
      ctx.fillRect(x + a, y, 1, 1);
      ctx.fillRect(x - a, y, 1, 1);
      ctx.fillRect(x, y + a, 1, 1);
      ctx.fillRect(x, y - a, 1, 1);
    }
    if (k > 0.75) {                                     // op het hoogtepunt ook de schuine stralen
      ctx.fillStyle = GLINT_DIAGONAL;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x + 1, y + 1, 1, 1);
      ctx.fillRect(x - 1, y - 1, 1, 1);
      ctx.fillRect(x + 1, y - 1, 1, 1);
      ctx.fillRect(x - 1, y + 1, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  drawEqualizer(t, levels, playing) {
    const dt = Math.min(0.1, Math.max(0, t - this.lastTime));
    this.lastTime = t;
    const beat = Math.pow(Math.max(0, Math.sin(t * 2 * Math.PI * 2.1)), 3);
    for (let i = 0; i < this.barCount; i++) {
      let target;
      if (!playing) {
        target = 0.03;
      } else if (levels) {
        const position = (i / (this.barCount - 1)) * (levels.length - 1);
        const low = Math.min(levels.length - 1, Math.max(0, Math.trunc(position)));
        const high = Math.min(low + 1, levels.length - 1);
        const fraction = position - low;
        const raw = levels[low] * (1 - fraction) + levels[high] * fraction;
        // Echte metingen zitten vlak onder de top: onder de drempel blijft de balk leeg, zodat alleen het echte ritme
        // overblijft. De gevoeligheid uit de instellingen verschuift die drempel.
        const floor = Math.min(0.9, Math.max(0, EQ_FLOOR_BASE + (1 - this.opts.eqSensitivity) * EQ_FLOOR_SPREAD));
        target = Math.pow(Math.min(1, Math.max(0, (raw - floor) / (EQ_TOP - floor))), EQ_GAMMA);
      } else {
        const wobble = 0.45 + 0.30 * Math.sin(t * 2.1 + i * 0.7) + 0.20 * Math.sin(t * 3.7 + i * 1.9);
        target = Math.min(1, Math.max(0.05, wobble * (0.65 + 0.35 * beat)));
      }
      this.barLevels[i] = target > this.barLevels[i] ? target : Math.max(target, this.barLevels[i] - dt * 1.6);
    }
    const ctx = this.ctx;
    const barWidth = Math.trunc(this.width / this.barCount);
    for (let i = 0; i < this.barCount; i++) {
      const blocks = Math.trunc(this.barLevels[i] * this.maxBlocks);
      const left = i * barWidth + Math.trunc((this.width - this.barCount * barWidth) / 2);
      for (let b = 0; b < blocks; b++) {
        const level = b / this.maxBlocks;
        ctx.fillStyle = this.palette.equalizer[Math.min(EQ_STEPS - 1, Math.trunc(level * EQ_STEPS))];
        const bottom = this.equalizerBottom - b * EQ_BLOCK_HEIGHT;
        ctx.fillRect(left + 1, bottom - EQ_BLOCK_HEIGHT + 1, barWidth - 2, EQ_BLOCK_HEIGHT - 1);
      }
    }
  }

  drawSlogan(t) {
    if (this.sloganList.length === 0) return;
    const period = 5.5;
    const turn = Math.trunc(t / period);
    if (turn !== this.sloganPeriod) {
      // Een slogan met {tijd} krijgt de tijd van nu; die blijft staan tot hij weer aan de beurt is.
      this.sloganPeriod = turn;
      this.sloganText = resolveSlogan(this.sloganList[turn % this.sloganList.length]);
    }
    const local = t % period;
    if (local > 4.6) return;
    const full = this.sloganText;
    const shown = Math.min(full.length, Math.trunc(local * 16));
    if (shown === 0) return;
    const font = this.fonts.forest;
    const x = (this.width - font.width(full, this.sloganScale)) / 2;
    const ctx = this.sloganCtx;
    ctx.clearRect(0, 0, this.width, this.sloganCanvas.height);
    font.drawText(ctx, full.slice(0, shown), x, 0, this.sloganScale);
    const image = ctx.getImageData(0, 0, this.width, this.sloganHeight);
    this.applyPlasma(image.data, t);
    ctx.putImageData(image, 0, 0);
    this.ctx.drawImage(this.sloganCanvas, 0, this.sloganTop);
  }

  // Plasma-kleurcyclus: een golvend veld van sinussen bepaalt per pixel de kleur, en die schuift door de tijd
  // heen door het hele spectrum. De lichte en donkere tinten van het lettertype blijven behouden.
  applyPlasma(data, t) {
    const tau = 2 * Math.PI;
    const centerX = this.width / 2;
    const w = this.width;
    for (let y = 0; y < this.sloganHeight; y++) {
      const sy = y + this.sloganTop;
      const rowTerm = Math.sin(sy * 0.22 + t * 1.7);
      const dy = sy - this.sloganTop;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] === 0) continue;
        const light = (0.30 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]) / 255;
        const dx = x - centerX;
        const field = Math.sin(x * 0.05 + t * 1.3) + rowTerm + Math.sin((x + sy) * 0.035 - t * 1.1) +
          Math.sin(Math.sqrt(dx * dx + dy * dy) * 0.06 + t * 0.9);
        const phase = Math.floor((field / 8 + 0.5 + t * 0.12) * 24) / 24;
        const strength = 0.35 + 0.90 * light;
        data[i] = Math.min(255, Math.trunc((0.5 + 0.5 * Math.cos(tau * phase)) * strength * 255));
        data[i + 1] = Math.min(255, Math.trunc((0.5 + 0.5 * Math.cos(tau * (phase + 0.33))) * strength * 255));
        data[i + 2] = Math.min(255, Math.trunc((0.5 + 0.5 * Math.cos(tau * (phase + 0.67))) * strength * 255));
        data[i + 3] = 255;
      }
    }
  }

  // De zendernaam helt heen en weer: eerst gaat de bovenkant naar rechts en de onderkant naar links (cursief), dan weer
  // recht, dan de andere kant op. Daarnaast zwiert de hele naam heen en weer door het beeld, een kwart slag verschoven:
  // de naam is het verst opzij op het moment dat hij recht staat.
  drawTitle() {
    const ctx = this.ctx;
    const phase = this.hazePhase * TITLE_SWING_SPEED;
    const lean = Math.sin(phase) * this.cfg.hazeAmplitude * TITLE_LEAN;
    const sway = Math.cos(phase) * this.cfg.hazeAmplitude * TITLE_SWAY;
    const half = this.titleGlyphHeight / 2;
    for (let y = 0; y < this.titleHeight; y++) {
      const dx = round(sway - ((y - half) / half) * lean);
      ctx.drawImage(this.titleCanvas, 0, y, this.width, 1, dx, TITLE_TOP + y, this.width, 1);
    }
  }

  drawScroller(t) {
    const count = this.scrollChars.length;
    if (count === 0) return;
    const font = this.scrollerFont;
    const speed = 0.22 * this.width;
    const startX = this.width - ((t * speed) % (this.scrollTotal + this.width));
    const k = (2 * Math.PI) / (this.width / WAVE_LENGTH_DIVISOR);
    const phase = this.wavePhase;
    const axis = this.reflectionAxis;
    const ctx = this.ctx;
    const rctx = this.reflectionCtx;
    rctx.clearRect(0, 0, this.width, REFLECTION_ROWS);

    for (let i = 0; i < count; i++) {
      const ch = this.scrollChars[i];
      const x = round(startX + this.scrollOffsets[i]);
      if (x > this.width || x < -font.cellWidth) continue;
      const wave = Math.sin(k * (x + font.advance(ch, this.scrollScale) / 2) - phase);
      const y = round(this.scrollTop + WAVE_AMPLITUDE * wave);
      font.draw(ctx, ch, x + 1, y + 1, this.scrollScale, this.scrollShadow);
      font.draw(ctx, ch, x, y, this.scrollScale);
      // Spiegelbeeld: dezelfde horizontale positie en golf, verticaal omgedraaid onder de as.
      rctx.save();
      rctx.translate(x, axis - y);
      rctx.scale(1, -1);
      font.draw(rctx, ch, 0, 0, this.scrollScale, this.scrollHalf);
      rctx.restore();
    }

    // Naar beneden toe vervagen met een geordend dither-patroon (geen vloeiende overgang).
    const image = rctx.getImageData(0, 0, this.width, REFLECTION_ROWS);
    const data = image.data;
    for (let row = 0; row < REFLECTION_ROWS; row++) {
      const fade = Math.pow(row / REFLECTION_ROWS, REFLECTION_FADE_POWER);
      for (let col = 0; col < this.width; col++) {
        const i = (row * this.width + col) * 4;
        if (data[i + 3] !== 0 && fade > BAYER[(row & 3) * 4 + (col & 3)]) data[i + 3] = 0;
      }
    }
    rctx.putImageData(image, 0, 0);
    ctx.drawImage(this.reflectionCanvas, 0, axis);
  }

  // Klein en middel staan midden in de koperbalken. Groot staat links, onder het spiegelbeeld van de scroller (zonder dat
  // er iets overheen valt); is daar minder ruimte (grote scroller of zendernaam), dan wordt hij vanzelf kleiner, en is er
  // te weinig ruimte voor minstens de kleine maat, dan staat hij gewoon klein midden in de koperbalken.
  drawCover(dt) {
    const source = this.coverSource;
    const shown = Boolean(source) && this.opts.showCover;
    this.coverFade = shown ? Math.min(1, this.coverFade + dt / COVER_FADE_SECONDS) : Math.max(0, this.coverFade - dt / COVER_FADE_SECONDS);
    if (!source || this.coverFade <= 0) return;

    let size = COVER_SIZES[this.opts.coverSize] || COVER_SIZES.small;
    let underReflection = false;
    if (this.opts.coverSize === 'large') {
      const free = this.height - COVER_BOTTOM_MARGIN - (this.reflectionAxis + REFLECTION_ROWS + COVER_GAP);
      if (free >= COVER_SIZES.small) {
        size = Math.min(size, free);
        underReflection = true;
      } else {
        size = COVER_SIZES.small;
      }
    }
    const top = underReflection
      ? this.reflectionAxis + REFLECTION_ROWS + COVER_GAP
      : this.height - COPPER_HEIGHT + Math.trunc((COPPER_HEIGHT - size) / 2);
    // Waar de hoes staat: standaard (klein en middel in het midden, groot links), of vast links, midden of rechts.
    let left;
    switch (this.opts.coverPosition) {
      case 'left': left = COVER_LEFT_MARGIN; break;
      case 'center': left = Math.trunc((this.width - size) / 2); break;
      case 'right': left = this.width - size - COVER_LEFT_MARGIN; break;
      default: left = underReflection ? COVER_LEFT_MARGIN : Math.trunc((this.width - size) / 2);
    }
    if (!this.coverCanvas || this.coverCanvasSize !== size) {
      this.coverCanvas = amigaCover(source, size);
      this.coverCanvasSize = size;
    }

    const ctx = this.ctx;
    const alpha = this.coverFade;
    // Schaduw rechts en onder, donkere rand om de hoes en een lichte rand links en boven (als een lijstje).
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = '#000000';
    ctx.fillRect(left + 2, top + 2, size + 1, size + 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#2A1606';
    ctx.fillRect(left - 1, top - 1, size + 2, size + 2);
    ctx.drawImage(this.coverCanvas, left, top);
    ctx.fillStyle = this.palette.gold[1];
    ctx.fillRect(left - 1, top - 1, size + 2, 1);
    ctx.fillRect(left - 1, top - 1, 1, size + 2);
    ctx.globalAlpha = 1;
  }

  // Koper en goud: een donker koperschijnsel met daarop zes balken die om één as draaien. De hoogte van een balk is een
  // sinus, de diepte een cosinus: de balken aan de achterkant zijn donkerder en worden door de voorste overdekt.
  drawCopper() {
    const ctx = this.ctx;
    const zoneStart = this.height - COPPER_HEIGHT;
    for (let y = zoneStart; y < this.height; y++) {
      ctx.fillStyle = this.palette.glow[Math.min(COPPER_HEIGHT - 1, Math.max(0, y - zoneStart))];
      ctx.fillRect(0, y, this.width, 1);
    }
    const bars = [];
    for (let k = 0; k < COPPER_BARS; k++) {
      const angle = this.copperPhase + (k * 2 * Math.PI) / COPPER_BARS;
      bars.push({ k, y: zoneStart + COPPER_HEIGHT / 2 + Math.sin(angle) * COPPER_ORBIT, depth: Math.cos(angle) });
    }
    bars.sort((a, b) => a.depth - b.depth); // achterste eerst, voorste als laatste
    for (const bar of bars) {
      const ramp = bar.k % 2 === 0 ? this.palette.gold : this.palette.copper;
      const dim = Math.round((1 - (bar.depth + 1) / 2) * 2.6); // hoe verder weg, hoe donkerder
      for (let i = 0; i < COPPER_THICKNESS; i++) {
        const y = round(bar.y + i - COPPER_THICKNESS / 2);
        if (y < zoneStart || y >= this.height) continue;
        ctx.fillStyle = ramp[Math.min(6, BAR_PROFILE[i] + dim)];
        ctx.fillRect(0, y, this.width, 1);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Geluidsspectrum: dezelfde berekening als SpectrumAudioProcessor.kt (Hann-venster, FFT van 1024, 24 banden
// tussen 60 en 14000 Hz, elke band afgezet tegen zijn eigen recente piek).
// ------------------------------------------------------------------------------------------------
const N = 1024;
const BANDS = 24;
const MIN_FREQ = 60;
const MAX_FREQ = 14000;
const SPAN_DB = 24;
const HEADROOM_DB = 3;
const PEAK_DECAY_DB_PER_SEC = 4;
const FLOOR_DB = -50;

export class SpectrumAnalyser {
  constructor(audioContext, source) {
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    source.connect(this.analyser);
    this.sampleRate = audioContext.sampleRate;
    this.time = new Float32Array(this.analyser.fftSize);
    this.re = new Float32Array(N);
    this.im = new Float32Array(N);
    this.hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    this.peak = new Float32Array(BANDS).fill(FLOOR_DB);
    this.bands = new Float32Array(BANDS);
    this.bandStart = new Int32Array(BANDS);
    this.bandEnd = new Int32Array(BANDS);
    this.lastUpdate = 0;
    this.computeBands();
  }

  computeBands() {
    const maxFreq = Math.min(MAX_FREQ, this.sampleRate / 2 - 1);
    const binWidth = this.sampleRate / N;
    let previous = Math.max(1, Math.trunc(MIN_FREQ / binWidth));
    for (let b = 0; b < BANDS; b++) {
      const high = MIN_FREQ * Math.pow(maxFreq / MIN_FREQ, (b + 1) / BANDS);
      const start = Math.min(previous, N / 2 - 1);
      const end = Math.min(N / 2, Math.max(start + 1, Math.round(high / binWidth)));
      this.bandStart[b] = start;
      this.bandEnd[b] = end;
      previous = end;
    }
  }

  /** Meet het geluid van dit moment. `dt` is de tijd sinds de vorige meting in seconden. */
  update(dt) {
    this.analyser.getFloatTimeDomainData(this.time);
    const offset = this.time.length - N;
    for (let i = 0; i < N; i++) {
      this.re[i] = this.time[offset + i] * this.hann[i];
      this.im[i] = 0;
    }
    this.fft();
    const peakDecay = PEAK_DECAY_DB_PER_SEC * dt;
    const release = 0.04 * (this.sampleRate / 512) * dt;
    for (let b = 0; b < BANDS; b++) {
      let power = 0;
      const count = this.bandEnd[b] - this.bandStart[b];
      for (let k = this.bandStart[b]; k < this.bandEnd[b]; k++) power += this.re[k] * this.re[k] + this.im[k] * this.im[k];
      const magnitude = Math.sqrt(power / count) / (N / 4);
      const db = 20 * Math.log10(magnitude + 1e-7);
      const level = Math.min(1, Math.max(0, (db - (this.peak[b] + HEADROOM_DB - SPAN_DB)) / SPAN_DB));
      this.peak[b] = Math.max(db, this.peak[b] - peakDecay, FLOOR_DB);
      this.bands[b] = Math.max(level, this.bands[b] - release);
    }
    return this.bands;
  }

  reset() {
    this.peak.fill(FLOOR_DB);
    this.bands.fill(0);
  }

  fft() {
    const { re, im } = this;
    let j = 0;
    for (let i = 1; i < N; i++) {
      let bit = N >> 1;
      while ((j & bit) !== 0) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      if (i < j) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (let length = 2; length <= N; length <<= 1) {
      const angle = (-2 * Math.PI) / length;
      const wlr = Math.cos(angle);
      const wli = Math.sin(angle);
      const half = length >> 1;
      for (let i = 0; i < N; i += length) {
        let wr = 1;
        let wi = 0;
        for (let k = 0; k < half; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + half] * wr - im[i + k + half] * wi;
          const vi = re[i + k + half] * wi + im[i + k + half] * wr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + half] = ur - vr; im[i + k + half] = ui - vi;
          const nr = wr * wlr - wi * wli;
          wi = wr * wli + wi * wlr;
          wr = nr;
        }
      }
    }
  }
}

/** Tekst die door de scroller loopt: "artiest - titel", of een vaste tekst als de zender niets doorgeeft. */
export function scrollText(title) {
  return title && title.trim() ? title.trim() : tr('Live radio uitzending', 'Live radio broadcast');
}
