// Tests voor de pure delen van de pagina (zonder browser): taal, back-up, slogans, tijd en de bilinguale servermeldingen.
// De pagina-modules raken bij het laden alleen `document.documentElement` en `localStorage` aan; die zetten we eerst klaar.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const listeners = [];
before(async () => {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  globalThis.document = { documentElement: {}, dispatchEvent: (e) => listeners.push(e.type), addEventListener() {} };
  globalThis.CustomEvent ??= class { constructor(type) { this.type = type; } };
  Object.defineProperty(globalThis, 'navigator', { value: { languages: ['nl-NL'] }, configurable: true });
});

const load = (name) => import(`../public/js/${name}.js`);

test('taal: volg de browser, kies Nederlands of English en bewaar de keuze', async () => {
  const i18n = await load('i18n');
  assert.equal(i18n.lang(), 'nl'); // Nederlandse browser
  assert.equal(i18n.tr('ja', 'yes'), 'ja');
  i18n.setLangSetting('en');
  assert.equal(i18n.tr('ja', 'yes'), 'yes');
  assert.equal(i18n.locale(), 'en-GB');
  assert.equal(store.get('ew.lang'), 'en');
  assert.ok(listeners.includes('ew:lang'));
  i18n.setLangSetting('auto');
  assert.equal(store.has('ew.lang'), false);
  Object.defineProperty(globalThis, 'navigator', { value: { languages: ['de-DE'] }, configurable: true });
  assert.equal(i18n.lang(), 'en'); // niet-Nederlandse browser: Engels
  Object.defineProperty(globalThis, 'navigator', { value: { languages: ['nl-BE'] }, configurable: true });
  assert.equal(i18n.lang(), 'nl');
});

test('back-up: heen en weer, zonder tokens, met weggefilterde rommel', async () => {
  const { makeBackup, parseBackup, fileName } = await load('backup');
  const text = makeBackup('etherwave', {
    language: 'en', visualizer: true,
    vis: { copperMode: 'all', sparkling: false, eqSensitivity: 0.7, dim: false, cover: true, coverSize: 'large', coverPosition: 'left' },
    slogans: ['Hello {tijd}', 'x'.repeat(100)], volume: 0.4,
    favorites: ['npo-3fm', 'npo-3fm', '<script>', 'qmusic'], last: 'qmusic'
  }, new Date('2026-11-26T10:00:00Z'));
  const raw = JSON.parse(text);
  assert.equal(raw.format, 'radio-backup');
  assert.equal(raw.platform, 'web');
  assert.deepEqual(raw.favorites, ['npo-3fm', 'qmusic']); // dubbel en onzin eruit
  assert.doesNotMatch(text, /token|password|wachtwoord/i);

  const { backup, error } = parseBackup(text);
  assert.equal(error, undefined);
  assert.equal(backup.language, 'en');
  assert.equal(backup.volume, 0.4);
  assert.equal(backup.vis.copperMode, 'all');
  assert.equal(backup.vis.coverSize, 'large');
  assert.equal(backup.vis.eqSensitivity, 0.7);
  assert.equal(backup.slogans[0], 'Hello {tijd}');
  assert.ok(backup.slogans[1].length <= 32);
  assert.equal(backup.lastStation, 'qmusic');
  assert.equal(fileName('etherwave-', new Date(2026, 10, 5)), 'etherwave-2026-11-05.json');
});

test('back-up: foutcodes en onbekende velden', async () => {
  const { parseBackup } = await load('backup');
  assert.equal(parseBackup('geen json').error, 'json');
  assert.equal(parseBackup('[]').error, 'format');
  assert.equal(parseBackup(JSON.stringify({ format: 'iets-anders', formatVersion: 1 })).error, 'format');
  assert.equal(parseBackup(JSON.stringify({ format: 'radio-backup', formatVersion: 99, platform: 'web' })).error, 'version');
  assert.equal(parseBackup(JSON.stringify({ format: 'radio-backup', formatVersion: 1, platform: 'android' })).error, 'app-backup');
  assert.equal(parseBackup('x'.repeat(1024 * 1024 + 1)).error, 'big');
  const minimal = parseBackup(JSON.stringify({ format: 'radio-backup', formatVersion: 1, platform: 'web', onbekend: { a: 1 } }));
  assert.equal(minimal.backup.language, 'auto');
  assert.equal(minimal.backup.volume, null);
  assert.equal(minimal.backup.vis, null);
  assert.deepEqual(minimal.backup.favorites, []);
  // Waarden buiten bereik worden begrensd, geen fout
  const wild = parseBackup(JSON.stringify({ format: 'radio-backup', formatVersion: 1, platform: 'web', settings: { volume: 5, vis: { eqSensitivity: 99, coverSize: 'enorm' } } }));
  assert.equal(wild.backup.volume, 1);
  assert.ok(wild.backup.vis.eqSensitivity <= 1.5);
  assert.notEqual(wild.backup.vis.coverSize, 'enorm');
});

test('slogans: grenzen en standaardlijst', async () => {
  const { coerceSlogans, coerceVis } = await load('state');
  const many = Array.from({ length: 50 }, (_, i) => `slogan ${i}`);
  assert.equal(coerceSlogans(many).length, 30);
  assert.deepEqual(coerceSlogans(['  a  ', '', '   ', 'b']), ['a', 'b']);
  assert.equal(coerceSlogans(null), null); // geen eigen lijst: de standaardslogans gelden
  assert.equal(coerceVis({}).copperMode, 'off');
});

test('visualizer: {tijd} wordt de lokale tijd, in 24- of 12-uurs notatie', async () => {
  const { clockText, resolveSlogan } = await load('visualizer');
  const at = new Date(2026, 10, 26, 13, 5);
  const text = clockText(at);
  assert.match(text, /^(13:05|1:05 PM)$/);
  assert.equal(resolveSlogan('Tijd {tijd} en {TIJD}', at).includes('{'), false);
  assert.ok(resolveSlogan('Hallo', at).length > 0);
});

test('visualizer: het beeld past zich aan de verhouding van het scherm aan', async () => {
  const { logicalSize } = await load('visualizer');
  const LOGICAL_WIDTH = 455, LOGICAL_HEIGHT = 256;   // de standaardmaat (16:9)
  // Liggend: vaste hoogte, de breedte volgt de verhouding (binnen de grenzen).
  assert.deepEqual(logicalSize(LOGICAL_WIDTH / LOGICAL_HEIGHT), { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT });
  assert.equal(logicalSize(16 / 9).height, LOGICAL_HEIGHT);
  assert.equal(logicalSize(16 / 9).width, Math.round(LOGICAL_HEIGHT * 16 / 9));
  assert.equal(logicalSize(10).width, 683);   // heel breed blijft begrensd
  // Staand: vaste breedte, de hoogte volgt de verhouding (binnen de grenzen).
  const phone = logicalSize(360 / 640);
  assert.equal(phone.width, 320);
  assert.equal(phone.height, Math.round(320 * 640 / 360));
  assert.deepEqual(logicalSize(390 / 844), { width: 320, height: 683 });   // een lang toestel loopt tegen de grens aan
  assert.equal(logicalSize(0.1).height, 683);
  // Onzin geeft de standaardmaat.
  for (const bad of [0, -1, NaN, Infinity, undefined, null, 'x']) {
    assert.deepEqual(logicalSize(bad), { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT });
  }
  // Nooit kleiner dan het minimum, nooit groter dan het maximum.
  for (const a of [0.2, 0.5, 0.75, 1, 1.5, 2, 2.4, 3, 6]) {
    const { width, height } = logicalSize(a);
    assert.ok(width >= 256 && width <= 683 && height >= 256 && height <= 683, `${a}: ${width}x${height}`);
  }
});

test('activiteit: een stilstaande muis telt niet mee, een echte beweging, tik of toets wel', async () => {
  const handlers = new Map();
  const saved = globalThis.document.addEventListener;
  globalThis.document.addEventListener = (type, fn) => handlers.set(type, fn);
  const { onActivity } = await load('activity');
  globalThis.document.addEventListener = saved;
  let count = 0;
  const stop = onActivity(() => { count++; });
  const pointer = (type, x, y) => handlers.get(type)({ type, clientX: x, clientY: y });
  pointer('pointermove', 100, 100); assert.equal(count, 1);
  pointer('pointermove', 100, 100); pointer('pointermove', 101, 102); assert.equal(count, 1);   // nepbeweging: de muis stond stil
  pointer('pointermove', 110, 100); assert.equal(count, 2);
  pointer('pointerdown', 110, 100); assert.equal(count, 3);
  handlers.get('keydown')({ type: 'keydown' }); assert.equal(count, 4);
  handlers.get('wheel')({ type: 'wheel' }); assert.equal(count, 5);
  stop();
  handlers.get('keydown')({ type: 'keydown' }); assert.equal(count, 5);
});

test('titel splitsen in artiest en nummer', async () => {
  const { splitTitle } = await load('title');
  assert.deepEqual(splitTitle('Daft Punk - One More Time'), ['Daft Punk', 'One More Time']);
  assert.deepEqual(splitTitle('Alleen een titel'), ['', 'Alleen een titel']);
  assert.deepEqual(splitTitle(''), ['', '']);
});
