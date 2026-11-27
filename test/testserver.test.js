// Tests voor de testserver zelf (dev/testserver.js): hij moet starten met de voorbeeldzenders, en mag niets naar een
// echte GitHub sturen. De "live"-stand wordt hier tegen een nep-GitHub geprobeerd, zodat de test geen internet nodig heeft.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../dev/testserver.js';
import { FakeGitHub, m3u } from './helpers.js';

async function withServer(options, fn) {
  const server = await startTestServer({ port: 0, ...options });
  try {
    await server.ready;
    await fn(server, (p, init) => fetch(`http://127.0.0.1:${server.port}${p}`, init));
  } finally {
    await server.stop();
  }
}

test('testserver (demo): voorbeeldzenders, de pagina en geen updatemelding', async () => {
  await withServer({ open: true }, async (server, get) => {
    const list = await (await get('/api/stations')).json();
    assert.ok(list.stations.length > 100, `${list.stations.length} zenders`);
    assert.ok(!list.error, String(list.error));
    assert.equal((await get('/')).status, 200);
    const update = await (await get('/api/update')).json();
    assert.equal(update.available, false);
    assert.ok(!update.error, String(update.error));
    // Alles praat met de nep-GitHub op dit toestel, niet met de echte.
    assert.match(server.github.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(server.config.apiUrl, server.github.url);
    assert.equal(server.config.rawUrl, server.github.url);
  });
});

test('testserver --update: er is een nieuwere versie, met uitleg in de taal van de bezoeker', async () => {
  await withServer({ update: true, open: true }, async (server, get) => {
    const update = await (await get('/api/update', { headers: { 'X-Lang': 'en' } })).json();
    assert.equal(update.available, true);
    assert.equal(update.latest, '99.0.0');
    assert.deepEqual(update.notes, ['New: this is a test notice from the test server']);
  });
});

test('testserver --live: leest de lijst van GitHub, schrijft niets en zet de updatecontrole uit', async () => {
  const github = await new FakeGitHub({ 'nederlandse-radio.m3u': m3u([{ name: 'Echte Zender', url: 'https://example.org/a.mp3' }]) }).start();
  try {
    await withServer({ live: true, open: true, sourceEnv: { GITHUB_API_URL: github.url, GITHUB_RAW_URL: github.url, GITHUB_READ_TOKEN: 'lees' } }, async (server, get) => {
      const list = await (await get('/api/stations')).json();
      assert.deepEqual(list.stations.map((s) => s.name), ['Echte Zender']);
      assert.equal(server.github, null);
      assert.equal(server.config.updateCheck, false);
    });
    assert.deepEqual(github.requests.filter((r) => r.method !== 'GET'), []);
  } finally {
    await github.stop();
  }
});

test('testserver: standaard is inloggen nodig (admin / test en de proefgebruiker anna), met --open niet', async () => {
  await withServer({}, async (server, get) => {
    assert.equal((await get('/api/stations')).status, 401);
    assert.equal((await get('/')).status, 200, 'de pagina zelf is open, anders is er geen inlogscherm');
    const post = (name, password) => get('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) });
    const anna = await post('anna', 'proefanna1');
    assert.equal(anna.status, 200);
    const cookie = anna.headers.get('set-cookie').split(';')[0];
    assert.equal((await get('/api/stations', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await post('admin', 'test')).status, 200);
    assert.equal((await post('anna', 'fout')).status, 401);
  });
  await withServer({ open: true }, async (server, get) => {
    assert.equal((await get('/api/stations')).status, 200);
    assert.equal(server.app.users.list().length, 1, 'alleen de beheerder, geen proefgebruiker');
  });
});

