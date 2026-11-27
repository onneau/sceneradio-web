// Tests voor de SceneRadio-webapp: alleen luisteren. De zenderlijst komt zonder token uit de publieke repository, de streams
// lopen via de container, en er bestaat geen beheer van de zenderlijst: geen tokens, geen schrijvende endpoints. Inloggen
// (met ADMIN_PASSWORD) is optioneel; de meeste tests hier draaien zonder, zoals een webapp zonder wachtwoord. De tests van
// de accounts zelf staan in accounts.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeGitHub, FakeRadio, startApp, m3u } from './helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LOGO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 0x11)]);

async function withApp(files, env, fn) {
  const github = await new FakeGitHub(files).start();
  const ctx = await startApp({ github, env: { GITHUB_READ_TOKEN: '', ADMIN_PASSWORD: '', ...env } });
  try {
    await fn({ ...ctx, github });
  } finally {
    await ctx.stop();
    await github.stop();
  }
}

function playlist(radio) {
  return {
    'nederlandse-radio.m3u': m3u([
      { name: 'Goede Zender', url: `${radio.url}/plain`, group: 'Pop;Dance', logo: 'logos/goede-zender.jpg?v=abc12345' },
      { name: 'ICY Zender', url: `${radio.url}/icy`, group: 'Pop' },
      { name: 'Kapotte Zender', url: `${radio.url}/notfound`, group: 'Rock' }
    ]),
    'logos/goede-zender.jpg': LOGO
  };
}

test('de lijst en de logo\'s komen zonder token uit de publieke repository, en de stream-URL blijft binnen', async () => {
  const radio = await new FakeRadio().start();
  try {
    await withApp(playlist(radio), {}, async ({ request, github }) => {
      const config = (await request('GET', '/api/config')).json;
      assert.equal(config.repo, 'onneau/sceneradio-m3u');
      assert.deepEqual(Object.keys(config).sort(), ['covers', 'deezer', 'loginRequired', 'repo', 'user', 'version']);
      assert.equal(config.loginRequired, false);
      assert.equal(config.user, null);
      assert.equal(config.deezer, false);

      const list = await request('GET', '/api/stations');
      assert.equal(list.status, 200);
      assert.deepEqual(list.json.stations.map((s) => s.name), ['Goede Zender', 'ICY Zender', 'Kapotte Zender']);
      assert.deepEqual(list.json.stations[0].genres, ['Pop', 'Dance']);
      assert.doesNotMatch(JSON.stringify(list.json), /127\.0\.0\.1|http:\/\//, 'geen stream-URL naar buiten');

      const logo = await request('GET', '/api/logo/goede-zender?v=abc12345');
      assert.equal(logo.status, 200);
      assert.equal(logo.headers.get('content-type'), 'image/jpeg');
      assert.deepEqual(logo.buffer, LOGO);
      assert.equal((await request('GET', '/api/logo/icy-zender')).status, 404);

      assert.equal(github.requests.length > 0, true);
      assert.equal(github.requests.every((r) => r.auth === ''), true, 'zonder token gevraagd');
    });
  } finally {
    await radio.stop();
  }
});

test('streams: doorgeven, ICY-titel apart, fouten van de bron', async () => {
  const radio = await new FakeRadio().start();
  try {
    await withApp(playlist(radio), {}, async ({ request }) => {
      const plain = await request('GET', '/api/stream/goede-zender');
      assert.equal(plain.status, 200);
      assert.equal(plain.headers.get('content-type'), 'audio/mpeg');
      assert.equal(plain.buffer.length, 1000);

      const icy = await request('GET', '/api/stream/icy-zender');
      const expected = Buffer.concat([0, 1, 2].map((n) => Buffer.alloc(16, 0x61 + n)));
      assert.deepEqual(icy.buffer, expected, 'de browser krijgt alleen audio');
      assert.equal((await request('GET', '/api/nowplaying/icy-zender')).json.title, 'Artiest - Nieuw nummer');
      assert.equal((await request('GET', '/api/nowplaying/goede-zender')).json.title, null);

      const bad = await request('GET', '/api/stream/kapotte-zender');
      assert.equal(bad.status, 502);
      assert.equal((await request('GET', '/api/stream/bestaat-niet')).status, 404);
    });
  } finally {
    await radio.stop();
  }
});

test('een luisteraar die weggaat sluit de verbinding met de bron', async () => {
  const radio = await new FakeRadio().start();
  try {
    await withApp(playlist(radio), {}, async ({ base, app }) => {
      const controller = new AbortController();
      const response = await fetch(`${base}/api/stream/icy-zender`, { signal: controller.signal });
      assert.equal(response.status, 200);
      await response.body.getReader().read();
      assert.equal(app.listeners.size, 1);
      controller.abort();
      for (let i = 0; i < 50 && app.listeners.size > 0; i++) await sleep(20);
      assert.equal(app.listeners.size, 0);
    });
  } finally {
    await radio.stop();
  }
});

test('MAX_LISTENERS: de volgende luisteraar krijgt een nette melding, in zijn eigen taal', async () => {
  const radio = await new FakeRadio().start();
  try {
    await withApp(playlist(radio), { MAX_LISTENERS: '1' }, async ({ base, request, app }) => {
      const controller = new AbortController();
      const first = await fetch(`${base}/api/stream/icy-zender`, { signal: controller.signal });
      await first.body.getReader().read();
      assert.equal(app.listeners.size, 1);
      const nl = await request('GET', '/api/stream/goede-zender', { headers: { 'X-Lang': 'nl' } });
      assert.equal(nl.status, 503);
      assert.match(nl.json.error, /te veel mensen/);
      const en = await request('GET', '/api/stream/goede-zender', { headers: { 'X-Lang': 'en' } });
      assert.equal(en.status, 503);
      assert.match(en.json.error, /Too many people/);
      controller.abort();
    });
  } finally {
    await radio.stop();
  }
});

test('streams in het eigen netwerk van de server worden niet doorgegeven (SSRF)', async () => {
  const radio = await new FakeRadio().start(); // staat op 127.0.0.1
  try {
    await withApp(playlist(radio), { ALLOW_PRIVATE_STREAMS: '' }, async ({ request }) => {
      const blocked = await request('GET', '/api/stream/goede-zender');
      assert.equal(blocked.status, 502);
      assert.equal(blocked.json.error, 'Adres in eigen netwerk niet toegestaan');
      assert.equal(radio.hits.length, 0, 'er is niets naar het eigen netwerk gestuurd');
    });
  } finally {
    await radio.stop();
  }
});

test('er is geen beheer van de zenderlijst: geen tokens en geen schrijvende endpoints, ook niet voor de beheerder', async () => {
  const radio = await new FakeRadio().start();
  try {
    // De testhulp zet GITHUB_ADMIN_TOKEN wel in de omgeving; de app mag er niets mee doen. Hier is inloggen aan
    // en logt de testhulp in als beheerder: zelfs dan bestaat er geen /api/admin.
    await withApp(playlist(radio), { ADMIN_PASSWORD: 'geheim' }, async ({ request, github }) => {
      for (const [method, url, body] of [
        ['GET', '/api/admin/status'],
        ['POST', '/api/admin/station', { name: 'X', url: 'https://example.org/x.mp3' }],
        ['POST', '/api/admin/logos', { ids: ['goede-zender'], logo: LOGO.toString('base64') }],
        ['POST', '/api/admin/check-all/start', {}]
      ]) {
        const r = await request(method, url, body === undefined ? {} : { body });
        assert.equal(r.status, 404, `${method} ${url}`);
      }
      const config = (await request('GET', '/api/config')).json;
      assert.equal(config.canWrite, undefined);
      assert.equal(config.hasReadToken, undefined);
      // ?all=1 geeft niets extra's: nog steeds de openbare lijst, zonder stream-URL's
      const all = await request('GET', '/api/stations?all=1');
      assert.equal(all.status, 200);
      assert.equal(all.json.stations.every((s) => !('url' in s) && !('hidden' in s)), true);
      assert.equal(github.requests.some((r) => r.method !== 'GET'), false, 'er is niets naar GitHub geschreven');
    });
  } finally {
    await radio.stop();
  }
});

test('de sessiecookie heeft een eigen naam (sr_session), zodat EtherWave web op dezelfde computer niet in de weg zit', async () => {
  const radio = await new FakeRadio().start();
  try {
    await withApp(playlist(radio), { ADMIN_PASSWORD: 'geheim' }, async ({ request, config }) => {
      assert.equal(config.cookieName, 'sr_session');
      const r = await request('POST', '/api/login', { body: { name: 'admin', password: 'geheim' } });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('set-cookie'), /^sr_session=/);
    });
  } finally {
    await radio.stop();
  }
});

test('de code bevat geen beheer van de zenderlijst: geen beheerpagina, geen GitHub-token, geen /api/admin', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const files = [];
  for (const dir of ['../server', '../public/js', '../public/js/views']) {
    for (const name of readdirSync(path.join(here, dir))) if (name.endsWith('.js')) files.push(path.join(here, dir, name));
  }
  assert.equal(files.some((f) => /manage\.js$|logo-picker\.js$/.test(f)), false);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /GITHUB_ADMIN_TOKEN|adminToken|\/api\/admin|RepoPublisher/, path.basename(file));
  }
});
