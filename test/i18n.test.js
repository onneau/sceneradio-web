// Tests voor de taal van de servermeldingen: X-Lang of Accept-Language bepaalt de taal, en bewaarde fouten
// (zenderlijst, updatecontrole) worden in de taal van de lezer getoond, niet in die van wie de fout veroorzaakte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeGitHub, startApp } from './helpers.js';
import { langOf, both, pick, runWithLang, tr } from '../server/i18n.js';
import { parseNotes } from '../server/updates.js';

async function withApp(files, env, fn) {
  const github = await new FakeGitHub(files).start();
  const ctx = await startApp({ github, env });
  try {
    await fn({ ...ctx, github });
  } finally {
    await ctx.stop();
    await github.stop();
  }
}

const NL = { 'X-Lang': 'nl' };
const EN = { 'X-Lang': 'en' };

test('taal van een verzoek: X-Lang wint, anders Accept-Language, anders Nederlands', () => {
  assert.equal(langOf({ headers: { 'x-lang': 'en', 'accept-language': 'nl-NL' } }), 'en');
  assert.equal(langOf({ headers: { 'x-lang': 'nl', 'accept-language': 'en-US' } }), 'nl');
  assert.equal(langOf({ headers: { 'accept-language': 'en-GB,en;q=0.9' } }), 'en');
  assert.equal(langOf({ headers: { 'accept-language': 'nl-NL,nl;q=0.9' } }), 'nl');
  assert.equal(langOf({ headers: { 'accept-language': 'de-DE' } }), 'nl');
  assert.equal(langOf({ headers: { 'x-lang': 'klingon' } }), 'nl');
  assert.equal(langOf({ headers: {} }), 'nl');
});

test('tr, both en pick volgen de taal van het lopende verzoek', () => {
  assert.equal(tr('hallo', 'hello'), 'hallo'); // zonder verzoek: Nederlands
  assert.equal(runWithLang('en', () => tr('hallo', 'hello')), 'hello');
  const message = both('fout', 'error');
  assert.equal(pick(message), 'fout');
  assert.equal(runWithLang('en', () => pick(message)), 'error');
  assert.equal(pick('gewone tekst'), 'gewone tekst');
});

test('updatenotities: per taal het juiste deel van de Release-tekst, met terugval op de andere taal', () => {
  const body = ['### Nederlands', '- Nieuw: tweetalig', '- Verbeterd: sneller', '', '### English', '- New: bilingual', '', 'Bijwerken / Update: docker compose pull'].join('\n');
  assert.deepEqual(parseNotes(body, 'nl'), ['Nieuw: tweetalig', 'Verbeterd: sneller']);
  assert.deepEqual(parseNotes(body, 'en'), ['New: bilingual']);
  const onlyDutch = '### Nederlands\n- Nieuw: alleen Nederlands\n### English\n';
  assert.deepEqual(parseNotes(onlyDutch, 'en'), ['Nieuw: alleen Nederlands']);
  assert.deepEqual(parseNotes('- Nieuw: zonder koppen', 'en'), ['Nieuw: zonder koppen']);
});

test('een fout zonder zenderlijst komt in de taal van de lezer, ook als een ander hem veroorzaakte', async () => {
  await withApp({}, {}, async ({ request }) => {
    const first = await request('GET', '/api/stations', { headers: NL });
    assert.equal(first.status, 503);
    assert.match(first.json.error, /staat niet in/);
    const second = await request('GET', '/api/stations', { headers: EN });
    assert.equal(second.status, 503);
    assert.match(second.json.error, /is not in/);
    assert.doesNotMatch(second.json.error, /staat niet/);
  });
});

test('een mislukte updatecontrole wordt in de taal van de lezer getoond', async () => {
  await withApp({}, {}, async ({ request, github }) => {
    github.release = null; // 404
    const nl = await request('GET', '/api/update', { headers: NL });
    assert.match(nl.json.error, /Geen release gevonden/);
    const en = await request('GET', '/api/update', { headers: EN });
    assert.match(en.json.error, /No release found/);
    assert.match(en.json.error, /GITHUB_READ_TOKEN/);
  });
});

test('gewone foutmeldingen volgen X-Lang', async () => {
  await withApp({}, {}, async ({ request }) => {
    const nl = await request('GET', '/api/bestaat-niet', { headers: NL });
    const en = await request('GET', '/api/bestaat-niet', { headers: EN });
    assert.equal(nl.status, 404);
    assert.equal(en.status, 404);
    assert.notEqual(nl.json.error, en.json.error);
  });
});
