import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CoverService, BusyError, leadArtist, cleanTitle, normalize, lucene, imageInfo, isDeezerImage } from '../server/covers.js';
import { FakeGitHub, startApp, close, m3u } from './helpers.js';

// Kleine nep-plaatjes met de juiste kop (de server leest alleen type en afmetingen).
function jpeg(width, height) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00', 'latin1'),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.alloc(20, 7)
  ]);
}
function png(width, height) {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'latin1');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return head;
}

const json = (value) => ({ status: 'ok', body: Buffer.from(JSON.stringify(value)) });
const image = (bytes) => ({ status: 'ok', body: bytes });
const NOT_FOUND = { status: 'notfound', body: null };

function recording(artist, groups, score = 100) {
  return {
    score,
    'artist-credit': [{ name: artist, artist: { name: artist } }],
    releases: groups.map((g) => ({
      'artist-credit': [{ name: g.by || artist }],
      'release-group': { id: g.id, 'secondary-types': g.types || [] }
    }))
  };
}

/** Een nep-internet: `routes` krijgt de URL en geeft { status, body } of undefined (= 404). Houdt de verzoeken bij. */
function fakeNet(routes) {
  const calls = [];
  const fetchBytes = async (url) => {
    calls.push(url);
    return (await routes(url)) || NOT_FOUND;
  };
  return { fetchBytes, calls };
}

function service(routes, options = {}) {
  const net = fakeNet(routes);
  const dir = mkdtempSync(path.join(tmpdir(), 'ew-cover-'));
  const sleeps = [];
  let clock = 1_000_000;
  const svc = new CoverService({
    dir, userAgent: 'test', gapMs: 0, fetchBytes: net.fetchBytes,
    now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; }, ...options
  });
  return { svc, net, dir, sleeps, advance: (ms) => { clock += ms; } };
}

test('tekst opschonen werkt als in de app', () => {
  assert.equal(leadArtist('Daft Punk feat. Pharrell'), 'Daft Punk');
  assert.equal(leadArtist('A & B'), 'A');
  assert.equal(leadArtist('A, B'), 'A');
  assert.equal(leadArtist('Mark Ronson ft. Bruno Mars'), 'Mark Ronson');
  assert.equal(leadArtist('Calvin Harris vs. Rihanna'), 'Calvin Harris');
  assert.equal(leadArtist('AC/DC'), 'AC');
  assert.equal(leadArtist('Max Verstappen'), 'Max Verstappen');
  assert.equal(cleanTitle('Titel (Radio Edit)'), 'Titel');
  assert.equal(cleanTitle('Titel [Remix] - Live'), 'Titel');
  assert.equal(cleanTitle('Gewoon'), 'Gewoon');
  assert.equal(normalize('Beyoncé – Déjà Vu!'), 'beyoncédéjàvu');
  assert.equal(lucene('a "b" \\ c'), 'a  b    c');
  assert.equal(isDeezerImage('https://cdn-images.dzcdn.net/images/artist/x/500x500.jpg'), true);
  assert.equal(isDeezerImage('http://cdn-images.dzcdn.net/x.jpg'), false);
  assert.equal(isDeezerImage('https://evil.example/x.jpg'), false);
  assert.equal(isDeezerImage('https://notdzcdn.net/x.jpg'), false);
});

test('imageInfo herkent JPEG, PNG en WebP en weigert de rest (ook SVG)', () => {
  assert.deepEqual(imageInfo(jpeg(500, 480)), { type: 'image/jpeg', width: 500, height: 480 });
  assert.deepEqual(imageInfo(png(300, 400)), { type: 'image/png', width: 300, height: 400 });
  const webp = Buffer.alloc(40);
  webp.write('RIFF', 0, 'latin1'); webp.write('WEBP', 8, 'latin1'); webp.write('VP8X', 12, 'latin1');
  webp.writeUIntLE(449, 24, 3); webp.writeUIntLE(599, 27, 3);
  assert.deepEqual(imageInfo(webp), { type: 'image/webp', width: 450, height: 600 });
  assert.equal(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(imageInfo(Buffer.from('<html>' + ' '.repeat(50))), null);
  assert.equal(imageInfo(Buffer.alloc(3)), null);
});

test('hoes: gewone release eerst, geen verzamelalbums, geen Various Artists, naam moet kloppen', async () => {
  const { svc, net } = service((url) => {
    if (url.startsWith('https://musicbrainz.org/ws/2/recording/')) {
      return json({ recordings: [
        recording('Daft Punk', [{ id: 'live', types: ['Live'] }, { id: 'comp', types: ['Compilation'] }, { id: 'va', by: 'Various Artists' }, { id: 'plain' }]),
        recording('Iemand Anders', [{ id: 'verkeerd' }]),
        recording('Daft Punk', [{ id: 'laagscore' }], 40)
      ] });
    }
    if (url === 'https://coverartarchive.org/release-group/plain/front-500') return image(jpeg(500, 500));
    return undefined;
  });
  const hit = await svc.find('Daft Punk', 'One More Time (Radio Edit)');
  assert.equal(hit.kind, 'cover');
  assert.equal(hit.type, 'image/jpeg');
  const cover = net.calls.filter((u) => u.includes('coverartarchive'));
  assert.deepEqual(cover, ['https://coverartarchive.org/release-group/plain/front-500']);
  const query = decodeURIComponent(net.calls[0]);
  assert.match(query, /artist:"Daft Punk" AND recording:"One More Time"/);
  assert.match(query, /limit=6/);
});

test('hoes: valt terug op 250 en op "live" als er niets gewoners is; maximaal 3 releasegroepen', async () => {
  const { svc, net } = service((url) => {
    if (url.includes('/recording/')) return json({ recordings: [recording('X', [{ id: 'l1', types: ['Live'] }, { id: 'l2', types: ['Soundtrack'] }, { id: 'l3', types: ['Remix'] }, { id: 'l4', types: ['Live'] }])] });
    if (url.endsWith('l3/front-250')) return image(png(250, 250));
    return undefined;
  });
  const hit = await svc.find('X', 'Y');
  assert.equal(hit.type, 'image/png');
  assert.equal(net.calls.some((u) => u.includes('l4')), false);
  assert.ok(net.calls.indexOf('https://coverartarchive.org/release-group/l1/front-500') < net.calls.indexOf('https://coverartarchive.org/release-group/l3/front-250'));
});

test('hoes: komt uit de cache, en een gemist nummer wordt onthouden (een storing niet)', async () => {
  let down = false;
  const { svc, net, advance } = service((url) => {
    if (down && url.includes('musicbrainz')) return { status: 'failed', body: null };
    if (url.includes('/recording/')) return json({ recordings: url.includes('Bekend') ? [recording('A', [{ id: 'g' }])] : [] });
    if (url.includes('/g/front-500')) return image(jpeg(500, 500));
    return undefined;
  });
  assert.ok(await svc.find('A', 'Bekend'));
  const after = net.calls.length;
  assert.ok(await svc.find('A', 'Bekend'));
  assert.equal(net.calls.length, after, 'tweede keer uit de cache');
  assert.equal((await new CoverService({ dir: svc.coverDir.replace(/covers$/, ''), userAgent: 't', gapMs: 0, fetchBytes: net.fetchBytes }).find('A', 'Bekend')).kind, 'cover', 'ook na een herstart');

  assert.equal(await svc.find('B', 'Onbekend'), null);
  const mb = net.calls.length;
  assert.equal(await svc.find('B', 'Onbekend'), null);
  assert.equal(net.calls.length, mb, 'gemist nummer wordt onthouden');
  advance(25 * 60 * 60 * 1000);
  assert.equal(await svc.find('B', 'Onbekend'), null);
  assert.ok(net.calls.length > mb, 'na een dag opnieuw proberen');

  down = true;
  const failedAt = net.calls.length;
  assert.equal(await svc.find('C', 'Storing'), null);
  assert.equal(await svc.find('C', 'Storing'), null);
  assert.equal(net.calls.length, failedAt + 2, 'een storing wordt niet onthouden');
});

test('hoes: artiest en titel omgewisseld wordt nog één keer geprobeerd', async () => {
  const { svc, net } = service((url) => {
    const q = decodeURIComponent(url);
    if (q.includes('/recording/') && q.includes('artist:"One More Time"')) return json({ recordings: [] });
    if (q.includes('/recording/') && q.includes('artist:"Daft Punk"')) return json({ recordings: [recording('Daft Punk', [{ id: 'g' }])] });
    if (url.includes('/g/front-500')) return image(jpeg(500, 500));
    return undefined;
  });
  assert.ok(await svc.find('One More Time', 'Daft Punk'));
  assert.equal(net.calls.filter((u) => u.includes('/recording/')).length, 2);
});

test('hoes: MusicBrainz krijgt hooguit één verzoek per pauze, en de wachtrij is begrensd', async () => {
  const { svc, sleeps } = service(() => json({ recordings: [] }), { gapMs: 1100 });
  await svc.find('A', 'Een');
  await svc.find('A', 'Twee');
  assert.ok(sleeps.length >= 1 && sleeps.every((ms) => ms > 0 && ms <= 1100), 'er is gewacht tussen twee verzoeken');

  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = service(async () => { await gate; return json({ recordings: [] }); }, { maxQueue: 2 });
  const a = slow.svc.find('A', 'Een');
  const b = slow.svc.find('B', 'Twee');
  await new Promise((r) => setImmediate(r));
  await assert.rejects(slow.svc.find('C', 'Drie'), BusyError);
  release();
  await Promise.all([a, b]);
});

test('hoes: dezelfde vraag tegelijk geeft één zoekopdracht', async () => {
  const { svc, net } = service(async (url) => (url.includes('/recording/') ? json({ recordings: [] }) : undefined));
  await Promise.all([svc.find('A', 'Zelfde'), svc.find('A', 'Zelfde'), svc.find('a', 'zelfde (live)')]);
  // één zoekopdracht plus de omgewisselde poging, niet drie keer zoveel
  assert.equal(net.calls.filter((u) => u.includes('/recording/')).length, 2);
});

const WIKI = (url) => {
  const q = decodeURIComponent(url);
  if (q.includes('/ws/2/artist/?query=')) return json({ artists: [{ id: 'mb1', name: 'Daft Punk', score: 100 }, { id: 'mb2', name: 'Daft Punk Tribute', score: 96 }] });
  if (url.startsWith('https://musicbrainz.org/ws/2/artist/mb1?inc=url-rels')) return json({ relations: [{ type: 'official homepage', url: { resource: 'https://x' } }, { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q185828' } }] });
  if (url.startsWith('https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=Q185828&property=P18')) return json({ claims: { P18: [{ mainsnak: { datavalue: { value: 'Daft Punk in 2013.jpg' } } }] } });
  if (url === 'https://commons.wikimedia.org/wiki/Special:FilePath/Daft%20Punk%20in%202013.jpg?width=500') return image(jpeg(500, 600));
  return undefined;
};

test('artiestenfoto: MusicBrainz, Wikidata, Wikimedia Commons (alleen als er geen hoes is)', async () => {
  const { svc, net } = service(WIKI);
  assert.equal(await svc.find('Daft Punk', 'Geen hoes hier'), null, 'zonder photo=1 geen foto');
  const hit = await svc.find('Daft Punk feat. Iemand', 'Geen hoes hier', true);
  assert.equal(hit.kind, 'photo');
  assert.equal(hit.type, 'image/jpeg');
  assert.ok(net.calls.some((u) => u.includes('Special:FilePath')));
  const again = net.calls.length;
  assert.equal((await svc.find('Daft Punk', 'Ander nummer', true)).kind, 'photo');
  assert.equal(net.calls.filter((u) => u.includes('Special:FilePath')).length, 1, 'foto uit de cache');
  assert.ok(net.calls.length > again, 'de hoes van het andere nummer is wel gezocht');
});

test('artiestenfoto: een hoes gaat voor, en te kleine of onzekere foto\'s tellen niet', async () => {
  const withCover = service((url) => {
    if (url.includes('/recording/')) return json({ recordings: [recording('Daft Punk', [{ id: 'g' }])] });
    if (url.includes('/g/front-500')) return image(jpeg(500, 500));
    return WIKI(url);
  });
  assert.equal((await withCover.svc.find('Daft Punk', 'Titel', true)).kind, 'cover');
  assert.equal(withCover.net.calls.some((u) => u.includes('wikidata')), false);

  const tiny = service((url) => (url.includes('Special:FilePath') ? image(jpeg(80, 80)) : WIKI(url)));
  assert.equal(await tiny.svc.find('Daft Punk', 'Titel', true), null);
  assert.ok(readdirSync(tiny.svc.photoDir).some((f) => f.endsWith('.none')), 'te klein wordt onthouden');

  const unsure = service((url) => (url.includes('/ws/2/artist/?query=') ? json({ artists: [{ id: 'm', name: 'Daft Punk', score: 90 }] }) : WIKI(url)));
  assert.equal(await unsure.svc.find('Daft Punk', 'Titel', true), null, 'score onder 95');
});

test('artiestenfoto: Deezer als tweede bron, met controle op het adres; een storing wordt niet onthouden', async () => {
  const deezer = (picture) => (url) => {
    if (url.startsWith('https://api.deezer.com/search/artist')) return json({ data: [{ name: 'Iemand Anders', picture_big: 'https://cdn-images.dzcdn.net/x/other.jpg' }, { name: 'Test Band', picture_big: picture, picture_xl: 'https://cdn-images.dzcdn.net/images/artist/abc/1000x1000.jpg' }] });
    if (url === 'https://cdn-images.dzcdn.net/images/artist/abc/1000x1000.jpg') return image(png(500, 500));
    if (url.includes('musicbrainz')) return json({ artists: [] });
    return undefined;
  };
  const ok = service(deezer('https://cdn-images.dzcdn.net/images/artist//500x500.jpg'), { deezer: true });
  const hit = await ok.svc.find('Test Band', 'Titel', true);
  assert.equal(hit.kind, 'photo');
  assert.equal(hit.type, 'image/png');

  const off = service(deezer('https://cdn-images.dzcdn.net/images/artist/abc/500.jpg'), { deezer: false });
  assert.equal(await off.svc.find('Test Band', 'Titel', true), null, 'Deezer staat uit');

  const evil = service((url) => (url.startsWith('https://api.deezer.com/') ? json({ data: [{ name: 'Test Band', picture_big: 'https://evil.example/a.jpg', picture_xl: 'http://localhost/a.jpg' }] }) : json({ artists: [] })), { deezer: true });
  assert.equal(await evil.svc.find('Test Band', 'Titel', true), null);
  assert.equal(evil.net.calls.some((u) => u.includes('evil.example') || u.includes('localhost')), false);

  let broken = true;
  const flaky = service((url) => (broken && url.includes('musicbrainz') ? { status: 'failed', body: null } : url.includes('musicbrainz') ? json({ artists: [] }) : undefined), { deezer: true });
  assert.equal(await flaky.svc.find('Test Band', 'Titel', true), null);
  assert.equal(readdirSync(flaky.svc.photoDir).some((f) => f.endsWith('.none')), false, 'storing: niets onthouden');
  broken = false;
  assert.equal(await flaky.svc.find('Test Band', 'Titel', true), null);
  assert.equal(readdirSync(flaky.svc.photoDir).some((f) => f.endsWith('.none')), true, 'echt niets: wel onthouden');
});

test('artiestenfoto: een "geen foto" verloopt na 14 dagen', async () => {
  const { svc, net, advance } = service(() => json({ artists: [] }));
  await svc.find('Niemand', 'X', true);
  const first = net.calls.length;
  await svc.find('Niemand', 'Y', true);
  assert.equal(net.calls.filter((u) => u.includes('/artist/?query')).length, 1);
  assert.ok(net.calls.length > first - 1);
  const file = path.join(svc.photoDir, readdirSync(svc.photoDir).find((f) => f.endsWith('.none')));
  const old = new Date(Date.now() - 15 * 24 * 3600 * 1000);
  utimesSync(file, old, old);
  svc.now = () => Date.now();
  await svc.find('Niemand', 'Z', true);
  assert.equal(net.calls.filter((u) => u.includes('/artist/?query')).length, 2);
  void advance;
});

test('de cache is begrensd tot 150 hoezen', async () => {
  const { svc } = service((url) => {
    if (url.includes('/recording/')) return json({ recordings: [recording('A', [{ id: 'g' }])] });
    if (url.includes('/g/front-500')) return image(jpeg(500, 500));
    return undefined;
  });
  for (let i = 0; i < 155; i++) await svc.find('A', `Nummer ${i}`);
  assert.equal(readdirSync(svc.coverDir).length, 150);
});

// ---------------------------------------------------------------------------- via de HTTP-API

async function withApp(env, routes, fn) {
  const github = await new FakeGitHub({ 'nederlandse-radio.m3u': m3u([{ name: 'Test', url: 'http://127.0.0.1:1/x' }]) }).start();
  const net = fakeNet(routes);
  const ctx = await startApp({ github, env, fetchBytes: net.fetchBytes });
  try {
    await fn(ctx, net);
  } finally {
    await close(ctx.app.server);
    await github.stop();
  }
}

test('GET /api/art geeft het plaatje, 404 zonder hoes, en wordt per bezoeker begrensd', async () => {
  const routes = (url) => {
    if (url.includes('/recording/')) return json({ recordings: decodeURIComponent(url).includes('Bekend') ? [recording('Daft Punk', [{ id: 'g' }])] : [] });
    if (url.includes('/g/front-500')) return image(jpeg(500, 500));
    return undefined;
  };
  await withApp({ COVERS_GAP_MS: '0', COVERS_RATE_PER_MINUTE: '4' }, routes, async ({ request }) => {
    const ok = await request('GET', '/api/art?artist=Daft%20Punk&title=Bekend');
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/jpeg');
    assert.equal(ok.headers.get('x-art-kind'), 'cover');
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(imageInfo(ok.buffer), { type: 'image/jpeg', width: 500, height: 500 });

    const none = await request('GET', '/api/art?artist=Daft%20Punk&title=Onbekend', { headers: { 'X-Lang': 'en' } });
    assert.equal(none.status, 404);
    assert.equal(none.json.error, 'No cover found.');
    const nl = await request('GET', '/api/art?artist=Daft%20Punk&title=Onbekend');
    assert.equal(nl.json.error, 'Geen hoes gevonden.');

    const empty = await request('GET', '/api/art?artist=&title=');
    assert.equal(empty.status, 404);
    const limited = await request('GET', '/api/art?artist=Daft%20Punk&title=Bekend', { headers: { 'X-Lang': 'en' } });
    assert.equal(limited.status, 429);
    assert.match(limited.json.error, /Too many/);
  });
});

test('COVERS=false zet de hoezen uit; /api/config meldt het', async () => {
  await withApp({ COVERS: 'false' }, () => undefined, async ({ request }) => {
    assert.equal((await request('GET', '/api/art?artist=A&title=B')).status, 404);
    const config = (await request('GET', '/api/config')).json;
    assert.equal(config.covers, false);
    assert.equal(config.deezer, false);
  });
  await withApp({}, () => undefined, async ({ request }) => {
    const config = (await request('GET', '/api/config')).json;
    assert.equal(config.covers, true);
    assert.equal(config.deezer, false); // de publieke versie gebruikt geen Deezer
  });
});

test('servermeldingen volgen X-Lang (en Accept-Language)', async () => {
  await withApp({}, () => undefined, async ({ request }) => {
    const nl = await request('GET', '/api/onbekend');
    assert.equal(nl.json.error, 'Niet gevonden.');
    const en = await request('GET', '/api/onbekend', { headers: { 'X-Lang': 'en' } });
    assert.equal(en.json.error, 'Not found.');
    const accept = await request('GET', '/api/onbekend', { headers: { 'Accept-Language': 'en-GB,en;q=0.9' } });
    assert.equal(accept.json.error, 'Not found.');
    const dutch = await request('GET', '/api/onbekend', { headers: { 'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.5' } });
    assert.equal(dutch.json.error, 'Niet gevonden.');
    const both = await request('GET', '/api/onbekend', { headers: { 'X-Lang': 'nl', 'Accept-Language': 'en' } });
    assert.equal(both.json.error, 'Niet gevonden.', 'X-Lang gaat voor');
    const login = await request('POST', '/api/login', { body: { password: 'fout' }, headers: { 'X-Lang': 'en' } });
    assert.equal(login.json.error, 'Username or password is not correct.');
    const loginNl = await request('POST', '/api/login', { body: { name: 'iemand', password: 'fout' } });
    assert.equal(loginNl.json.error, 'Gebruikersnaam of wachtwoord klopt niet.');
    const closed = await request('GET', '/api/stations', { headers: { 'X-Lang': 'en' }, anonymous: true });
    assert.equal(closed.json.error, 'Log in first.');
  });
});
