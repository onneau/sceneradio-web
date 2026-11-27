// Tests voor de accounts: de beheerder maakt gebruikers aan, iedereen logt in met naam en wachtwoord, en het profiel
// (favorieten en instellingen) staat per account op de server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FakeGitHub, startApp, m3u } from './helpers.js';
import { Users, hashPassword, verifyPassword, generatePassword, cleanName, checkPassword, AccountError } from '../server/users.js';

const FILES = { 'nederlandse-radio.m3u': m3u([{ name: 'Test', url: 'http://127.0.0.1:1/x' }]) };

async function withApp(env, fn) {
  const github = await new FakeGitHub(FILES).start();
  const ctx = await startApp({ github, env });
  try {
    await fn(ctx);
  } finally {
    await ctx.stop();
    await github.stop();
  }
}

const post = (request, url, body, extra = {}) => request('POST', url, { body, ...extra });

/** Logt in en geeft de cookie terug (als "naam=waarde"). */
async function loginAs(request, name, password, extra = {}) {
  const r = await post(request, '/api/login', { name, password, ...extra }, { anonymous: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.headers.get('set-cookie').split(';')[0];
}

const backup = (favorites, settings = {}) => JSON.stringify({ format: 'radio-backup', formatVersion: 1, platform: 'web', app: 'x', createdAt: '2026-01-01T00:00:00Z', settings, favorites, lastStation: favorites[0] ?? null });

// ---------------------------------------------------------------------------------------------- eenheden

test('wachtwoorden: scrypt-hash, controle en gegenereerde wachtwoorden', async () => {
  const hash = await hashPassword('een goed wachtwoord');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(hash.includes('een goed wachtwoord'), false);
  assert.equal(await verifyPassword('een goed wachtwoord', hash), true);
  assert.equal(await verifyPassword('een goed wachtwoord ', hash), false);
  assert.notEqual(await hashPassword('een goed wachtwoord'), hash, 'elke hash heeft eigen zout');
  assert.equal(await verifyPassword('x', 'rommel'), false);
  assert.equal(await verifyPassword('x', 'scrypt$4294967296$8$1$aa$bb'), false, 'absurde kosten worden niet uitgevoerd');
  for (let i = 0; i < 50; i++) assert.match(generatePassword(), /^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/);
  assert.notEqual(generatePassword(), generatePassword());
});

test('gebruikersnaam en wachtwoord: regels', () => {
  assert.equal(cleanName('  Anna  '), 'anna');
  assert.equal(cleanName('jan.de-vries_2'), 'jan.de-vries_2');
  for (const bad of ['', 'a', 'admin', 'ADMIN', '.punt', '-streep', 'a b', 'ä-ö', 'x'.repeat(33), '../etc', null, undefined, 5]) {
    assert.throws(() => cleanName(bad), AccountError, String(bad));
  }
  assert.equal(checkPassword('12345678'), '12345678');
  assert.throws(() => checkPassword('1234567'), AccountError);
  assert.throws(() => checkPassword('x'.repeat(201)), AccountError);
  assert.throws(() => checkPassword(12345678), AccountError);
  assert.throws(() => checkPassword(undefined), AccountError);
});

test('Users: bewaren in de data-map, blijft na een herstart, zonder leesbare wachtwoorden', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'users-test-'));
  try {
    const users = new Users(dir);
    const anna = await users.create('Anna', 'welkom-anna');
    assert.equal(anna.name, 'anna');
    assert.equal(anna.hash, undefined, 'de weergave bevat nooit de hash');
    await assert.rejects(users.create('anna', 'ander-wachtwoord'), /bestaat al/);
    await assert.rejects(users.create('admin', 'ander-wachtwoord'), /gereserveerd/);
    const raw = readFileSync(path.join(dir, 'users.json'), 'utf8');
    assert.equal(raw.includes('welkom-anna'), false);
    assert.match(raw, /scrypt\$/);
    if (process.platform !== 'win32') assert.equal(statSync(path.join(dir, 'users.json')).mode & 0o077, 0, 'alleen de eigenaar mag het bestand lezen');

    const again = new Users(dir); // herstart
    assert.deepEqual(again.list().map((u) => u.name), ['admin', 'anna']);
    assert.ok((await again.check('anna', 'welkom-anna')).user);
    assert.equal((await again.check('anna', 'fout-wachtwoord')).user, null);
    assert.equal((await again.check('niemand', 'welkom-anna')).user, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Users: een kapot bestand of vreemde inhoud geeft alleen de beheerder en geen crash', () => {
  for (const text of ['niet json', '[]', '{"users":"nee"}', '{"users":[{"id":"../x","name":"a","hash":"b"},null,5]}']) {
    const dir = mkdtempSync(path.join(tmpdir(), 'users-test-'));
    try {
      writeFileSync(path.join(dir, 'users.json'), text);
      assert.deepEqual(new Users(dir).list().map((u) => u.name), ['admin'], text);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------------------------- toegang

test('zonder inlog kom je nergens, en config verklapt niets', async () => {
  await withApp({}, async ({ request }) => {
    const config = await request('GET', '/api/config', { anonymous: true });
    assert.equal(config.status, 200);
    assert.deepEqual(config.json, { loginRequired: true, user: null });
    for (const [method, url] of [['GET', '/api/stations'], ['GET', '/api/update'], ['GET', '/api/me'], ['GET', '/api/users'], ['GET', '/api/stream/test'], ['GET', '/api/logo/test'], ['POST', '/api/me/profile'], ['POST', '/api/users']]) {
      const r = await request(method, url, { anonymous: true, ...(method === 'POST' ? { body: {} } : {}) });
      assert.equal(r.status, 401, `${method} ${url}`);
    }
    // de pagina zelf is open: anders is er geen inlogscherm
    assert.equal((await request('GET', '/', { anonymous: true })).status, 200);
    assert.equal((await request('GET', '/js/start.js', { anonymous: true })).status, 200);
    assert.equal((await request('POST', '/api/logout', { anonymous: true })).status, 200);
  });
});

test('de beheerder maakt een gebruiker aan; de gebruiker kan luisteren maar niet beheren', async () => {
  await withApp({}, async ({ request }) => {
    const made = await post(request, '/api/users', { name: 'Anna' });
    assert.equal(made.status, 200);
    assert.equal(made.json.user.name, 'anna');
    assert.match(made.json.password, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/, 'zonder eigen wachtwoord verzint de server er een');
    const chosen = await post(request, '/api/users', { name: 'bram', password: 'zelf-gekozen-1' });
    assert.equal(chosen.json.password, undefined, 'een zelf gekozen wachtwoord sturen we niet terug');

    const cookie = await loginAs(request, 'anna', made.json.password);
    const config = await request('GET', '/api/config', { cookie });
    assert.deepEqual(config.json.user, { name: 'anna', role: 'user' });
    assert.equal(config.json.canWrite, undefined, 'een gebruiker krijgt de beheerinstellingen niet te zien');
    assert.equal(config.json.hasReadToken, undefined);
    assert.equal((await request('GET', '/api/stations', { cookie })).status, 200);

    for (const [method, url] of [['GET', '/api/users'], ['POST', '/api/users'], ['POST', `/api/users/${made.json.user.id}/delete`]]) {
      const r = await request(method, url, { cookie, ...(method === 'POST' ? { body: { name: 'xx', password: '12345678' } } : {}) });
      assert.equal(r.status, 403, `${method} ${url}`);
    }
    assert.equal((await request('GET', '/api/users')).json.users.length, 3, 'admin, anna en bram');
  });
});

test('aanmaken: dubbele of ongeldige naam, te kort wachtwoord, te veel gebruikers, en een groot verzoek wordt geweigerd', async () => {
  await withApp({}, async ({ request, app }) => {
    assert.equal((await post(request, '/api/users', { name: 'anna' })).status, 200);
    const dupe = await post(request, '/api/users', { name: 'ANNA' });
    assert.equal(dupe.status, 409);
    assert.equal((await post(request, '/api/users', { name: 'admin' })).status, 400);
    assert.equal((await post(request, '/api/users', { name: '../x' })).status, 400);
    assert.equal((await post(request, '/api/users', { name: 'kort', password: '1234567' })).status, 400);
    const en = await post(request, '/api/users', { name: 'anna' }, { headers: { 'X-Lang': 'en' } });
    assert.equal(en.json.error, 'This username already exists.');
    const huge = await post(request, '/api/users', { name: 'x'.repeat(10000) });
    assert.equal(huge.status, 413);
    for (let i = 0; i < 99; i++) app.users.users.push({ id: `u${String(i).padStart(12, '0')}`, name: `gebruiker${i}`, hash: 'x', sv: 1 });
    assert.equal((await post(request, '/api/users', { name: 'een-te-veel' })).status, 409);
  });
});

test('inloggen: een fout wachtwoord en een onbekende naam geven dezelfde melding; een uitgeschakeld account wordt uitgelegd', async () => {
  await withApp({}, async ({ request }) => {
    const anna = (await post(request, '/api/users', { name: 'anna', password: 'welkom-anna' })).json.user;
    const wrong = await post(request, '/api/login', { name: 'anna', password: 'fout-fout' }, { anonymous: true });
    const unknown = await post(request, '/api/login', { name: 'niemand', password: 'fout-fout' }, { anonymous: true });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.json, unknown.json);
    assert.equal(wrong.headers.get('set-cookie'), null);

    const cookie = await loginAs(request, 'Anna', 'welkom-anna'); // hoofdletters maken niet uit
    assert.equal((await request('GET', '/api/stations', { cookie })).status, 200);

    const off = await post(request, `/api/users/${anna.id}/disabled`, { disabled: true });
    assert.equal(off.json.user.disabled, true);
    assert.equal((await request('GET', '/api/stations', { cookie })).status, 401, 'een lopende sessie stopt meteen');
    const blocked = await post(request, '/api/login', { name: 'anna', password: 'welkom-anna' }, { anonymous: true });
    assert.equal(blocked.status, 403);
    assert.match(blocked.json.error, /uitgeschakeld/);
    const stillWrong = await post(request, '/api/login', { name: 'anna', password: 'fout-fout' }, { anonymous: true });
    assert.equal(stillWrong.status, 401, 'zonder het goede wachtwoord verklappen we niet dat het account bestaat');

    await post(request, `/api/users/${anna.id}/disabled`, { disabled: false });
    assert.equal((await post(request, '/api/login', { name: 'anna', password: 'welkom-anna' }, { anonymous: true })).status, 200);
  });
});

test('beheerder: wachtwoord opnieuw instellen en gebruiker verwijderen maken oude sessies ongeldig', async () => {
  await withApp({}, async ({ request, app }) => {
    const anna = (await post(request, '/api/users', { name: 'anna', password: 'welkom-anna' })).json.user;
    const cookie = await loginAs(request, 'anna', 'welkom-anna');
    await post(request, '/api/me/profile', { backup: backup(['npo-3fm']) }, { cookie });
    assert.ok(existsSync(app.users.profilePath(anna.id)));

    const reset = await post(request, `/api/users/${anna.id}/password`, {});
    assert.equal(reset.status, 200);
    assert.match(reset.json.password, /^[a-z2-9]{4}-/);
    assert.equal((await request('GET', '/api/stations', { cookie })).status, 401, 'de oude sessie is weg');
    assert.equal((await post(request, '/api/login', { name: 'anna', password: 'welkom-anna' }, { anonymous: true })).status, 401, 'het oude wachtwoord werkt niet meer');
    const fresh = await loginAs(request, 'anna', reset.json.password);

    assert.equal((await post(request, `/api/users/${anna.id}/delete`, {})).status, 200);
    assert.equal((await request('GET', '/api/stations', { cookie: fresh })).status, 401);
    assert.equal(existsSync(app.users.profilePath(anna.id)), false, 'het profiel gaat mee');
    assert.equal((await post(request, `/api/users/${anna.id}/delete`, {})).status, 404);
    assert.equal((await post(request, '/api/users/u000000000000/password', {})).status, 404);
    assert.equal((await post(request, '/api/users/admin/password', {})).status, 404, 'de beheerder staat niet in de lijst met wijzigbare gebruikers');
    assert.equal((await post(request, '/api/users/..%2Fx/delete', {})).status, 404);
  });
});

test('eigen wachtwoord wijzigen: huidig wachtwoord nodig, andere apparaten loggen uit, dit apparaat blijft ingelogd', async () => {
  await withApp({}, async ({ request }) => {
    await post(request, '/api/users', { name: 'anna', password: 'welkom-anna' });
    const phone = await loginAs(request, 'anna', 'welkom-anna');
    const laptop = await loginAs(request, 'anna', 'welkom-anna');

    assert.equal((await post(request, '/api/me/password', { current: 'fout-fout', next: 'nieuw-wachtwoord' }, { cookie: phone })).status, 403);
    assert.equal((await post(request, '/api/me/password', { current: 'welkom-anna', next: 'kort' }, { cookie: phone })).status, 400);
    const changed = await post(request, '/api/me/password', { current: 'welkom-anna', next: 'nieuw-wachtwoord' }, { cookie: phone });
    assert.equal(changed.status, 200);
    const renewed = changed.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('GET', '/api/stations', { cookie: renewed })).status, 200, 'dit apparaat krijgt meteen een nieuwe cookie');
    assert.equal((await request('GET', '/api/stations', { cookie: phone })).status, 401);
    assert.equal((await request('GET', '/api/stations', { cookie: laptop })).status, 401);
    assert.equal((await post(request, '/api/login', { name: 'anna', password: 'welkom-anna' }, { anonymous: true })).status, 401);
    assert.equal((await post(request, '/api/login', { name: 'anna', password: 'nieuw-wachtwoord' }, { anonymous: true })).status, 200);
  });
});

test('de beheerder wijzigt zijn wachtwoord niet via de pagina: dat is ADMIN_PASSWORD', async () => {
  await withApp({}, async ({ request }) => {
    const r = await post(request, '/api/me/password', { current: 'geheim', next: 'nieuw-wachtwoord' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /ADMIN_PASSWORD/);
  });
});

test('overal uitloggen: alle apparaten van dit account, ook de beheerder', async () => {
  await withApp({}, async ({ request }) => {
    await post(request, '/api/users', { name: 'anna', password: 'welkom-anna' });
    const a = await loginAs(request, 'anna', 'welkom-anna');
    const b = await loginAs(request, 'anna', 'welkom-anna');
    const other = await loginAs(request, 'admin', 'geheim');
    const out = await post(request, '/api/me/logout-all', {}, { cookie: a });
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await request('GET', '/api/stations', { cookie: a })).status, 401);
    assert.equal((await request('GET', '/api/stations', { cookie: b })).status, 401);
    assert.equal((await request('GET', '/api/stations', { cookie: other })).status, 200, 'andere accounts blijven ingelogd');

    const admin2 = await loginAs(request, 'admin', 'geheim');
    await post(request, '/api/me/logout-all', {}, { cookie: other });
    assert.equal((await request('GET', '/api/stations', { cookie: other })).status, 401);
    assert.equal((await request('GET', '/api/stations', { cookie: admin2 })).status, 401);
    assert.equal((await post(request, '/api/login', { password: 'geheim' }, { anonymous: true })).status, 200, 'opnieuw inloggen kan gewoon');
  });
});

test('een ander ADMIN_PASSWORD zet alle beheersessies uit; zonder naam is het nog steeds de beheerder', async () => {
  await withApp({ SESSION_SECRET: 'vast-geheim', ADMIN_PASSWORD: 'eerste-wachtwoord' }, async ({ app }) => {
    const token = app.auth.makeToken({ uid: 'admin', name: 'admin', role: 'admin' });
    assert.ok(app.auth.verifyToken(token));
    const github = await new FakeGitHub(FILES).start();
    const second = await startApp({ github, env: { SESSION_SECRET: 'vast-geheim', ADMIN_PASSWORD: 'tweede-wachtwoord' } });
    try {
      assert.equal(second.app.auth.verifyToken(token), null, 'de oude cookie past niet bij het nieuwe wachtwoord');
      const oldStyle = await second.request('POST', '/api/login', { body: { password: 'tweede-wachtwoord' }, anonymous: true });
      assert.equal(oldStyle.status, 200, 'inloggen zonder naam (zoals voor accounts bestond) is de beheerder');
      assert.deepEqual(oldStyle.json.user, { name: 'admin', role: 'admin' });
    } finally {
      await second.stop();
      await github.stop();
    }
  });
});

test('inlogbegrenzing per gebruikersnaam: ook vanaf wisselende adressen', async () => {
  await withApp({ TRUST_PROXY: '1' }, async ({ request }) => {
    await post(request, '/api/users', { name: 'anna', password: 'welkom-anna' });
    for (let i = 0; i < 10; i++) {
      const r = await post(request, '/api/login', { name: 'anna', password: 'fout-fout' }, { anonymous: true, headers: { 'X-Forwarded-For': `10.0.1.${i}` } });
      assert.equal(r.status, 401, `poging ${i + 1}`);
    }
    const blocked = await post(request, '/api/login', { name: 'anna', password: 'welkom-anna' }, { anonymous: true, headers: { 'X-Forwarded-For': '10.0.2.1' } });
    assert.equal(blocked.status, 429);
    const other = await post(request, '/api/login', { name: 'admin', password: 'geheim' }, { anonymous: true, headers: { 'X-Forwarded-For': '10.0.2.1' } });
    assert.equal(other.status, 200, 'een andere naam wordt er niet door geraakt');
  });
});

test('cookie: eigen naam per app, ingelogd blijven of alleen een dag, en Secure achter https', async () => {
  await withApp({}, async ({ request, config }) => {
    assert.equal(config.cookieName, 'sr_session');
    const long = await post(request, '/api/login', { name: 'admin', password: 'geheim' }, { anonymous: true });
    assert.match(long.headers.get('set-cookie'), /^sr_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
    const short = await post(request, '/api/login', { name: 'admin', password: 'geheim', remember: false }, { anonymous: true });
    assert.equal(/Max-Age/.test(short.headers.get('set-cookie')), false, 'een sessiecookie: weg als de browser dicht gaat');
    const secure = await post(request, '/api/login', { name: 'admin', password: 'geheim' }, { anonymous: true, headers: { 'X-Forwarded-Proto': 'https' } });
    assert.match(secure.headers.get('set-cookie'), /; Secure$/);
  });
  await withApp({}, async ({ app }) => {
    const admin = { uid: 'admin', name: 'admin', role: 'admin' };
    const now = Date.now();
    const short = app.auth.makeToken(admin, { remember: false }, now);
    const long = app.auth.makeToken(admin, { remember: true }, now);
    assert.equal(Number(short.split('.')[2]) - now, 24 * 3600 * 1000);
    assert.ok(Number(long.split('.')[2]) - now > 24 * 3600 * 1000);
    assert.equal(app.auth.verifyToken(short, now + 25 * 3600 * 1000), null, 'de korte sessie verloopt na een dag');
    assert.ok(app.auth.verifyToken(long, now + 25 * 3600 * 1000));
  });
});

// ---------------------------------------------------------------------------------------------- profiel

test('profiel: opslaan en weer ophalen, per account apart', async () => {
  await withApp({}, async ({ request }) => {
    await post(request, '/api/users', { name: 'anna', password: 'welkom-anna' });
    await post(request, '/api/users', { name: 'bram', password: 'welkom-bram' });
    const anna = await loginAs(request, 'anna', 'welkom-anna');
    const bram = await loginAs(request, 'bram', 'welkom-bram');

    const empty = await request('GET', '/api/me', { cookie: anna });
    assert.equal(empty.json.profile, null);
    const saved = await post(request, '/api/me/profile', { backup: backup(['npo-3fm', 'qmusic', 'npo-3fm'], { lang: 'en' }) }, { cookie: anna });
    assert.equal(saved.status, 200);
    assert.ok(saved.json.updatedAt > 0);

    const mine = (await request('GET', '/api/me', { cookie: anna })).json.profile;
    assert.equal(mine.updatedAt, saved.json.updatedAt);
    const parsed = JSON.parse(mine.backup);
    assert.deepEqual(parsed.favorites, ['npo-3fm', 'qmusic'], 'dubbele favorieten verdwijnen');
    assert.equal(parsed.settings.lang, 'en');
    assert.equal((await request('GET', '/api/me', { cookie: bram })).json.profile, null, 'het profiel van een ander is niet te zien');
    assert.equal((await request('GET', '/api/users')).json.users.find((u) => u.name === 'anna').favorites, 2, 'de beheerder ziet alleen het aantal');
  });
});

test('profiel: updatedAt loopt altijd op, en onzin wordt geweigerd', async () => {
  await withApp({}, async ({ request, app }) => {
    const first = (await post(request, '/api/me/profile', { backup: backup(['a']) })).json.updatedAt;
    const second = (await post(request, '/api/me/profile', { backup: backup(['a', 'b']) })).json.updatedAt;
    assert.ok(second > first);
    assert.equal(app.users.saveProfile('admin', backup(['c']), 5) > second, true, 'een klok die achterloopt breekt de volgorde niet');

    for (const bad of [undefined, null, 5, 'geen json', '[]', '{}', JSON.stringify({ format: 'radio-backup', formatVersion: 1, platform: 'android' }), JSON.stringify({ format: 'iets-anders', formatVersion: 1, platform: 'web' }), JSON.stringify({ format: 'radio-backup', formatVersion: 'x', platform: 'web' })]) {
      const r = await post(request, '/api/me/profile', { backup: bad });
      assert.equal(r.status, 400, String(bad));
    }
    const big = backup([]).replace('"settings":{}', `"settings":{"x":"${'a'.repeat(600 * 1024)}"}`);
    assert.equal((await post(request, '/api/me/profile', { backup: big })).status, 413, 'te groot profiel');
    const cleaned = JSON.parse(app.users.getProfile('admin').backup);
    assert.deepEqual(cleaned.favorites, ['c'], 'wat al bewaard was, blijft heel');
  });
});

test('profiel: ongeldige zender-id\'s verdwijnen, en meer dan 5000 favorieten worden afgekapt', async () => {
  await withApp({}, async ({ request, app }) => {
    const ids = Array.from({ length: 5100 }, (_, i) => `z-${i}`);
    await post(request, '/api/me/profile', { backup: backup([...ids, '../etc/passwd', 'HOOFD', '', 5, null]) });
    const stored = JSON.parse(app.users.getProfile('admin').backup);
    assert.equal(stored.favorites.length, 5000);
    assert.equal(stored.favorites.some((f) => /[^a-z0-9-]/.test(f)), false);
  });
});

test('profiel: opslaan is per account begrensd', async () => {
  await withApp({}, async ({ request }) => {
    let last;
    for (let i = 0; i < 125; i++) last = await post(request, '/api/me/profile', { backup: backup([`z${i}`]) });
    assert.equal(last.status, 429);
  });
});

test('de gebruikerslijst: beheerder eerst, daarna op naam, zonder hashes', async () => {
  await withApp({}, async ({ request }) => {
    for (const name of ['zoe', 'anna', 'bram']) await post(request, '/api/users', { name, password: 'welkom-1234' });
    const list = (await request('GET', '/api/users')).json.users;
    assert.deepEqual(list.map((u) => u.name), ['admin', 'anna', 'bram', 'zoe']);
    assert.equal(list[0].role, 'admin');
    assert.equal(JSON.stringify(list).includes('scrypt'), false);
    assert.equal(JSON.stringify(list).includes('welkom'), false);
  });
});

// ---------------------------------------------------------------------------------------------- beveiliging

test('honderd gelijktijdige foute pogingen: er worden er maar een paar echt gecontroleerd (scrypt kost tijd)', async () => {
  await withApp({}, async ({ request, app }) => {
    let checked = 0;
    const original = app.users.check.bind(app.users);
    app.users.check = (...args) => { checked += 1; return original(...args); };
    const results = await Promise.all(Array.from({ length: 40 }, () => post(request, '/api/login', { name: 'niemand', password: 'fout-fout-fout' }, { anonymous: true })));
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 401).length, 5, 'vijf pogingen mogen mislukken');
    assert.equal(statuses.filter((s) => s === 429).length, 35);
    assert.equal(checked, 5, 'de rest komt er niet eens aan toe');
  });
});

test('wachtwoord wijzigen telt ook mee in de begrenzing: een gestolen sessie kan het wachtwoord niet raden', async () => {
  await withApp({}, async ({ request }) => {
    await post(request, '/api/users', { name: 'anna', password: 'welkom-anna' });
    const cookie = await loginAs(request, 'anna', 'welkom-anna');
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await post(request, '/api/me/password', { current: `fout-fout-${i}`, next: 'nieuw-wachtwoord' }, { cookie })).status);
    assert.deepEqual(codes, [403, 403, 403, 403, 403, 429, 429]);
    assert.equal((await request('GET', '/api/stations', { cookie })).status, 200, 'de sessie zelf blijft gewoon werken');
  });
});

test('een lopende sessie van een uitgeschakeld of verwijderd account werkt ook voor streams en logo\'s niet meer', async () => {
  await withApp({}, async ({ request }) => {
    const anna = (await post(request, '/api/users', { name: 'anna', password: 'welkom-anna' })).json.user;
    const cookie = await loginAs(request, 'anna', 'welkom-anna');
    for (const url of ['/api/stations', '/api/stream/test', '/api/logo/test', '/api/me']) assert.notEqual((await request('GET', url, { cookie })).status, 401, url);
    await post(request, `/api/users/${anna.id}/disabled`, { disabled: true });
    for (const url of ['/api/stations', '/api/stream/test', '/api/logo/test', '/api/me', '/api/art?artist=a&title=b']) assert.equal((await request('GET', url, { cookie })).status, 401, url);
  });
});

test('een cookie met een verknoeide of afgekorte inhoud, of van een ander account, wordt geweigerd', async () => {
  await withApp({}, async ({ request, app }) => {
    await post(request, '/api/users', { name: 'anna', password: 'welkom-anna' });
    await post(request, '/api/users', { name: 'bram', password: 'welkom-bram' });
    const anna = await loginAs(request, 'anna', 'welkom-anna');
    const bram = await loginAs(request, 'bram', 'welkom-bram');
    const [name, value] = anna.split('=');
    const parts = value.split('.');
    const bramId = bram.split('=')[1].split('.')[0];
    const forged = [
      `${name}=${parts[0]}.${parts[1]}.${Number(parts[2]) + 1000}.${parts[3]}`, // verloopdatum verlengd
      `${name}=${bramId}.${parts[1]}.${parts[2]}.${parts[3]}`, // het account van bram met de handtekening van anna
      `${name}=admin.${parts[1]}.${parts[2]}.${parts[3]}`, // beheerder worden
      `${name}=${parts.slice(0, 3).join('.')}`, // zonder handtekening
      `${name}=${value}.extra`,
      `${name}=`,
      `${name}=....`,
      'ander_cookie=' + value
    ];
    for (const cookie of forged) assert.equal((await request('GET', '/api/stations', { cookie })).status, 401, cookie);
    assert.equal((await request('GET', '/api/stations', { cookie: anna })).status, 200);
    assert.equal(app.auth.verifyToken(value.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))), null, 'één teken in de handtekening veranderd');
  });
});

test('logo\'s en hoezen mogen met inloggen niet in een gedeelde cache; zonder inlog wel', async () => {
  const github = await new FakeGitHub({ ...FILES }).start();
  const withLogin = await startApp({ github });
  const without = await startApp({ github, env: { ADMIN_PASSWORD: '' } });
  try {
    const a = await withLogin.request('GET', '/api/art?artist=niemand&title=niets');
    assert.match(a.headers.get('cache-control') || '', /^private/);
    const b = await without.request('GET', '/api/art?artist=niemand&title=niets');
    assert.match(b.headers.get('cache-control') || '', /^public/);
  } finally {
    await withLogin.stop();
    await without.stop();
    await github.stop();
  }
});

test('de sessiecookie en de gebruikersgegevens komen nooit in een antwoord van de server terecht', async () => {
  await withApp({}, async ({ request }) => {
    const made = await post(request, '/api/users', { name: 'anna', password: 'welkom-anna' });
    const cookie = await loginAs(request, 'anna', 'welkom-anna');
    const secret = cookie.split('=')[1];
    const bodies = [JSON.stringify(made.json), JSON.stringify((await request('GET', '/api/users')).json), JSON.stringify((await request('GET', '/api/me', { cookie })).json), JSON.stringify((await request('GET', '/api/config', { cookie })).json)];
    for (const body of bodies) {
      assert.equal(body.includes('scrypt'), false);
      assert.equal(body.includes(secret), false);
      assert.equal(body.includes('welkom-anna'), false);
    }
  });
});
