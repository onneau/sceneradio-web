import test from 'node:test';
import assert from 'node:assert/strict';
import { IcyStripper, parseIcyTitle, isPrivateAddress, describeError, httpGet } from '../server/net.js';
import { FakeRadio } from './helpers.js';

test('ICY: titel uit de metadata, ook met latin1-tekens', () => {
  assert.equal(parseIcyTitle(Buffer.from("StreamTitle='Artiest - Titel';StreamUrl='';")), 'Artiest - Titel');
  assert.equal(parseIcyTitle(Buffer.from("StreamTitle='';")), null);
  assert.equal(parseIcyTitle(Buffer.from("StreamTitle='Beyoncé - Halo';", 'latin1')), 'Beyoncé - Halo');
  assert.equal(parseIcyTitle(Buffer.from("StreamTitle='Rock 'n' Roll';")), "Rock 'n' Roll");
  assert.equal(parseIcyTitle(Buffer.from('niets')), null);
});

test('ICY: audio komt ongeschonden door, metadata blijft eruit, ook bij stukken van 1 byte', async () => {
  const metaint = 16;
  const audio = (n) => Buffer.alloc(metaint, 0x61 + n);
  const stream = Buffer.concat([audio(0), Buffer.from([0]), audio(1), FakeRadio.meta('Eerste - Titel'), audio(2), FakeRadio.meta('Tweede - Titel')]);
  for (const size of [1, 3, 7, 16, 17, 1000]) {
    const titles = [];
    const stripper = new IcyStripper(metaint, (t) => titles.push(t));
    const out = [];
    stripper.on('data', (c) => out.push(c));
    for (let i = 0; i < stream.length; i += size) stripper.write(stream.subarray(i, i + size));
    stripper.end();
    await new Promise((resolve) => stripper.on('end', resolve));
    assert.equal(Buffer.concat(out).toString(), Buffer.concat([audio(0), audio(1), audio(2)]).toString(), `stukgrootte ${size}`);
    assert.deepEqual(titles, ['Eerste - Titel', 'Tweede - Titel'], `stukgrootte ${size}`);
  }
});

test('adressen in het eigen netwerk worden herkend', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '172.31.255.255', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '151.101.1.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});


test('time-out wordt netjes gemeld', async () => {
  const radio = await new FakeRadio().start();
  try {
    await assert.rejects(httpGet(`${radio.url}/hang`, { allowPrivate: true, headerTimeout: 100 }), (e) => describeError(e) === 'Time-out');
  } finally {
    await radio.stop();
  }
});

test('foutmeldingen in gewoon Nederlands', () => {
  assert.equal(describeError({ code: 'ENOTFOUND' }), 'Host onbekend (DNS)');
  assert.equal(describeError({ code: 'ECONNREFUSED' }), 'Verbinding geweigerd');
  assert.equal(describeError({ code: 'CERT_HAS_EXPIRED' }), 'TLS-fout');
  assert.equal(describeError(new Error('iets anders')), 'Verbinding mislukt');
});
