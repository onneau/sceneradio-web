// Hoezen en artiestenfoto's, op dezelfde manier als in de apps (CoverArt.kt en ArtistPhoto.kt):
//  * de hoes: het nummer bij MusicBrainz zoeken (alleen artiest en titel gaan over de lijn), de hoes bij het Cover Art
//    Archive halen; geen verzamelalbums, geen "Various Artists", de naam van de artiest moet kloppen;
//  * de artiestenfoto, als er geen hoes is: MusicBrainz -> Wikidata -> Wikimedia Commons, daarna (alleen als COVERS_DEEZER
//    aanstaat) Deezer.
// De server doet het opzoeken, dus de browser van de bezoeker praat niet met die diensten. Gevonden plaatjes blijven in
// de map covers/ en artists/ van de datamap (hooguit 150 en 300). MusicBrainz krijgt hooguit één verzoek per seconde.
// De server snijdt niet bij: de pagina laat het vierkant zien (iets boven het midden), zoals de apps.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, utimesSync, renameSync } from 'node:fs';
import path from 'node:path';
import { httpGet, readLimited, FetchError } from './net.js';

const MIN_SCORE = 85;              // opnamen die MusicBrainz zelf niet zeker genoeg vindt, tellen niet
const MIN_ARTIST_SCORE = 95;       // een artiest alleen bij een zeer sterke overeenkomst met de naam
const MAX_RELEASE_GROUPS = 3;
const COVER_SIZES = [500, 250];
// Verzamelalbums geven nooit een hoes: liever geen plaatje dan het plaatje van een compilatie.
const EXCLUDED_TYPES = new Set(['compilation', 'dj-mix', 'mixtape/street']);
const MAX_COVERS = 150;
const MAX_PHOTOS = 300;
const MAX_COVER_MISSES = 300;
const COVER_MISS_MS = 24 * 60 * 60 * 1000;
const PHOTO_MISS_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_SIDE = 120;
const MAX_DOWNLOAD = 4 * 1024 * 1024;
const MAX_STORED = 2 * 1024 * 1024;
const MAX_TEXT = 1024 * 1024;

export class BusyError extends Error {}

// ---------------------------------------------------------------------------- tekst opschonen

/** "Artiest feat. Gast", "A & B" of "A, B" wordt de eerste artiest. */
export function leadArtist(raw) {
  const separators = /\s+(?:feat\.?|ft\.?|featuring|with|x)\s+|\s*[&,;/]\s*|\s+vs\.?\s+/i;
  return String(raw ?? '').trim().split(separators)[0].trim();
}

/** Haakjes en "- Radio Edit" eraf: "Titel (Radio Edit)" wordt "Titel". */
export function cleanTitle(raw) {
  const text = String(raw ?? '').replace(/\s*[(\[][^)\]]*[)\]]/g, '');
  const cut = text.indexOf(' - ');
  return (cut >= 0 ? text.slice(0, cut) : text).trim();
}

export function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** In de zoekopdracht van MusicBrainz (Lucene) zijn aanhalingstekens en backslashes bijzondere tekens. */
export function lucene(text) {
  return String(text ?? '').replace(/["\\]/g, ' ').trim();
}

export function sha1(text) {
  return createHash('sha1').update(String(text), 'utf8').digest('hex');
}

/** De Deezer-foto's staan alleen op https-adressen van Deezer zelf; een ander adres in het antwoord wordt genegeerd. */
export function isDeezerImage(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && (url.hostname.endsWith('.dzcdn.net') || url.hostname.endsWith('.deezer.com'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------- plaatjes herkennen

/** { type, width, height } van een JPEG, PNG of WebP, of null. Alleen die drie worden ooit doorgegeven (nooit SVG). */
export function imageInfo(b) {
  if (!Buffer.isBuffer(b) || b.length < 30) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let pos = 2;
    while (pos + 9 < b.length) {
      if (b[pos] !== 0xff) return null;
      const marker = b[pos + 1];
      if (marker === 0xff) { pos++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'image/jpeg', height: b.readUInt16BE(pos + 5), width: b.readUInt16BE(pos + 7) };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { pos += 2; continue; }
      pos += 2 + b.readUInt16BE(pos + 2);
    }
    return null;
  }
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const kind = b.toString('latin1', 12, 16);
    if (kind === 'VP8 ') return { type: 'image/webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      return {
        type: 'image/webp',
        width: 1 + (b[21] | ((b[22] & 0x3f) << 8)),
        height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10))
      };
    }
    if (kind === 'VP8X') return { type: 'image/webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  return null;
}

// ---------------------------------------------------------------------------- netwerk

/**
 * Standaardmanier om iets op te halen: { status: 'ok' | 'notfound' | 'failed', body }. Een 404 is "niet gevonden"; al het
 * andere dat misgaat (geen internet, storing, te veel verzoeken) is "mislukt". De tests geven hun eigen versie mee.
 */
export function makeFetcher(userAgent) {
  return async function fetchBytes(url, { maxBytes = MAX_DOWNLOAD } = {}) {
    try {
      const { res } = await httpGet(url, {
        headers: { 'User-Agent': userAgent, Accept: '*/*' },
        connectTimeout: 8000,
        headerTimeout: 12000,
        signal: AbortSignal.timeout(25000)
      });
      if (res.statusCode === 404) {
        res.resume();
        return { status: 'notfound', body: null };
      }
      if (res.statusCode !== 200) {
        res.resume();
        return { status: 'failed', body: null };
      }
      return { status: 'ok', body: await readLimited(res, maxBytes) };
    } catch (error) {
      return { status: error instanceof FetchError && error.code === 'TOOBIG' ? 'notfound' : 'failed', body: null };
    }
  };
}

function parseJson(reply) {
  if (!reply || reply.status !== 'ok' || !reply.body || reply.body.length > MAX_TEXT) return null;
  try {
    const value = JSON.parse(reply.body.toString('utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

const textOf = (value) => (typeof value === 'string' ? value : '');

// ---------------------------------------------------------------------------- de dienst

export class CoverService {
  /**
   * @param {object} o
   * @param {string} o.dir        datamap; hoezen komen in covers/ en artists/ daaronder
   * @param {string} o.userAgent  herkenbare User-Agent (zonder e-mailadres)
   * @param {boolean} [o.deezer]  Deezer als tweede bron voor artiestenfoto's
   * @param {number} [o.gapMs]    minimale pauze tussen twee verzoeken aan MusicBrainz
   * @param {number} [o.maxQueue] hoeveel zoekopdrachten er hooguit wachten; daarna "druk"
   */
  constructor({ dir, userAgent, deezer = false, gapMs = 1100, maxQueue = 12, fetchBytes, now = Date.now, sleep }) {
    this.coverDir = path.join(dir, 'covers');
    this.photoDir = path.join(dir, 'artists');
    mkdirSync(this.coverDir, { recursive: true });
    mkdirSync(this.photoDir, { recursive: true });
    this.deezer = deezer;
    this.gapMs = gapMs;
    this.maxQueue = maxQueue;
    this.fetchBytes = fetchBytes || makeFetcher(userAgent);
    this.now = now;
    this.sleep = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.tail = Promise.resolve();   // één zoekopdracht tegelijk, in volgorde van binnenkomst
    this.waiting = 0;
    this.lastMusicBrainz = 0;
    this.misses = new Map();         // hoeszoekopdracht -> tijdstip van "niets gevonden"
    this.inflight = new Map();
  }

  /** { bytes, type, kind: 'cover' | 'photo' } of null. Gooit BusyError als er te veel wachten. */
  async find(artist, title, withPhoto = false) {
    const name = leadArtist(artist);
    const song = cleanTitle(title);
    const key = `${normalize(name)}|${normalize(song)}|${withPhoto ? 1 : 0}`;
    if (!name || !song) return null;
    const running = this.inflight.get(key);
    if (running) return running;
    const job = this.findUncached(artist, title, name, song, withPhoto).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  async findUncached(artist, title, name, song, withPhoto) {
    const cover = await this.cover(artist, title, name, song);
    if (cover) return { ...cover, kind: 'cover' };
    if (!withPhoto) return null;
    const photo = await this.photo(name);
    return photo ? { ...photo, kind: 'photo' } : null;
  }

  // Eén zoekopdracht tegelijk: de wachtrij is begrensd, zodat niemand de dienst kan volpompen.
  async locked(work) {
    if (this.waiting >= this.maxQueue) throw new BusyError('busy');
    this.waiting++;
    const turn = this.tail.then(() => undefined);
    let release;
    this.tail = new Promise((resolve) => { release = resolve; });
    try {
      await turn;
      return await work();
    } finally {
      this.waiting--;
      release();
    }
  }

  async awaitMusicBrainz() {
    const wait = this.lastMusicBrainz + this.gapMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastMusicBrainz = this.now();
  }

  async musicBrainz(url) {
    await this.awaitMusicBrainz();
    return this.fetchBytes(url, { maxBytes: MAX_TEXT });
  }

  // ------------------------------------------------------------------ bestanden

  readFile(file) {
    try {
      const bytes = readFileSync(file);
      const now = new Date();
      utimesSync(file, now, now);   // de langst ongebruikte gaan als eerste weg
      return bytes;
    } catch {
      return null;
    }
  }

  writeFile(file, bytes) {
    try {
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, bytes);
      renameSync(temp, file);
    } catch {
      // zonder schrijfrechten werkt het nog, alleen zonder cache
    }
  }

  prune(dir, max) {
    try {
      const files = readdirSync(dir).filter((name) => !name.endsWith('.tmp')).map((name) => ({ name, at: statSync(path.join(dir, name)).mtimeMs }));
      if (files.length <= max) return;
      files.sort((a, b) => a.at - b.at).slice(0, files.length - max).forEach((f) => {
        try { unlinkSync(path.join(dir, f.name)); } catch { /* weg of in gebruik */ }
      });
    } catch {
      // niet erg
    }
  }

  usable(bytes) {
    const info = bytes && bytes.length <= MAX_STORED ? imageInfo(bytes) : null;
    return info && Math.min(info.width, info.height) >= 1 ? info : null;
  }

  // ------------------------------------------------------------------ de hoes

  async cover(artist, title, name, song) {
    const key = `${normalize(name)}|${normalize(song)}`;
    const file = path.join(this.coverDir, `${sha1(key)}.img`);
    const cached = this.readFile(file);
    const info = cached && this.usable(cached);
    if (info) return { bytes: cached, type: info.type };
    if (this.isMiss(key)) return null;

    return this.locked(async () => {
      // Een andere aanvraag kan de hoes intussen al hebben opgehaald.
      const again = this.readFile(file);
      const againInfo = again && this.usable(again);
      if (againInfo) return { bytes: again, type: againInfo.type };
      if (this.isMiss(key)) return null;

      let found = await this.lookup(name, song);
      if (found.state === 'none') {
        // Artiest en titel omgewisseld? Dan staat in de stream "Titel - Artiest" en is de titel hier de artiest.
        const swappedArtist = leadArtist(title);
        const swappedTitle = cleanTitle(artist);
        if (swappedArtist && swappedTitle && (normalize(swappedArtist) !== normalize(name) || normalize(swappedTitle) !== normalize(song))) {
          const second = await this.lookup(swappedArtist, swappedTitle);
          if (second.state !== 'none') found = second;
        }
      }
      if (found.state === 'found') {
        this.writeFile(file, found.bytes);
        this.prune(this.coverDir, MAX_COVERS);
        return { bytes: found.bytes, type: found.info.type };
      }
      if (found.state === 'none') this.remember(key);   // een storing wordt niet onthouden
      return null;
    });
  }

  isMiss(key) {
    const at = this.misses.get(key);
    if (at === undefined) return false;
    if (this.now() - at < COVER_MISS_MS) return true;
    this.misses.delete(key);
    return false;
  }

  remember(key) {
    this.misses.delete(key);
    this.misses.set(key, this.now());
    if (this.misses.size > MAX_COVER_MISSES) this.misses.delete(this.misses.keys().next().value);
  }

  async lookup(artist, title) {
    const groups = await this.findReleaseGroups(artist, title);
    if (groups === null) return { state: 'failed' };
    for (const id of groups) {
      for (const size of COVER_SIZES) {
        const reply = await this.fetchBytes(`https://coverartarchive.org/release-group/${encodeURIComponent(id)}/front-${size}`);
        const info = reply.status === 'ok' ? this.usable(reply.body) : null;
        if (info) return { state: 'found', bytes: reply.body, info };
      }
    }
    return { state: 'none' };
  }

  // MusicBrainz: de beste opnames bij artiest + titel, en daarvan de releasegroepen (singles, EP's en albums).
  // Verzamelalbums en releases van "Various Artists" worden nooit gebruikt. null = mislukt (storing, geen internet).
  async findReleaseGroups(artist, title) {
    const query = `artist:"${lucene(artist)}" AND recording:"${lucene(title)}"`;
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=6`;
    const reply = await this.musicBrainz(url);
    if (reply.status === 'failed') return null;
    const recordings = parseJson(reply)?.recordings;
    if (!Array.isArray(recordings)) return [];

    const wanted = normalize(artist);
    const plain = [];   // gewone singles, EP's en albums
    const other = [];   // live, soundtrack, remix en dergelijke: alleen als er niets gewoners is
    for (const recording of recordings) {
      if (!recording || typeof recording !== 'object') continue;
      if ((Number(recording.score) || 0) < MIN_SCORE) continue;
      if (!artistMatches(recording, wanted)) continue;
      for (const release of Array.isArray(recording.releases) ? recording.releases : []) {
        if (!release || typeof release !== 'object' || isVariousArtists(release)) continue;
        const group = release['release-group'];
        const id = textOf(group?.id);
        if (!id) continue;
        const types = (Array.isArray(group['secondary-types']) ? group['secondary-types'] : []).map((t) => textOf(t).toLowerCase());
        if (types.some((t) => EXCLUDED_TYPES.has(t))) continue;
        const target = types.length === 0 ? plain : other;
        if (!plain.includes(id) && !other.includes(id)) target.push(id);
      }
    }
    return [...plain, ...other].slice(0, MAX_RELEASE_GROUPS);
  }

  // ------------------------------------------------------------------ de artiestenfoto

  async photo(name) {
    const key = normalize(name);
    if (key.length < 2) return null;
    const hash = sha1(key);
    const file = path.join(this.photoDir, `${hash}.img`);
    const none = path.join(this.photoDir, `${hash}.none`);

    const known = this.readPhoto(file, none);
    if (known !== undefined) return known;

    return this.locked(async () => {
      const again = this.readPhoto(file, none);
      if (again !== undefined) return again;

      let result = await this.fromWikimedia(name, key);
      if (result.state !== 'found' && this.deezer) {
        const deezer = await this.fromDeezer(name, key);
        // Een storing bij de eerste bron blijft een storing, ook als Deezer gewoon niets heeft.
        result = deezer.state === 'found' || result.state !== 'failed' ? deezer : result;
      }
      if (result.state === 'found') {
        const info = this.usable(result.bytes);
        if (info && Math.min(info.width, info.height) >= MIN_SIDE) {
          this.writeFile(file, result.bytes);
          this.prune(this.photoDir, MAX_PHOTOS);
          return { bytes: result.bytes, type: info.type };
        }
        this.writeFile(none, 'onbruikbaar');
        return null;
      }
      if (result.state === 'none') {
        this.writeFile(none, 'geen foto');
        this.prune(this.photoDir, MAX_PHOTOS);
      }
      return null;   // bij een storing niets onthouden
    });
  }

  // Een bewaarde foto, of null voor "weet ik al: geen foto", of undefined als er nog niets bekend is.
  readPhoto(file, none) {
    const bytes = this.readFile(file);
    const info = bytes && this.usable(bytes);
    if (info) return { bytes, type: info.type };
    try {
      const age = this.now() - statSync(none).mtimeMs;
      if (age < PHOTO_MISS_MS) return null;
      unlinkSync(none);
    } catch {
      // geen markering
    }
    return undefined;
  }

  async fromWikimedia(name, key) {
    // 1. MusicBrainz: de artiest met precies deze naam en een zeer hoge score
    const search = await this.musicBrainz(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(`artist:"${lucene(name)}"`)}&fmt=json&limit=5`);
    if (search.status === 'failed') return { state: 'failed' };
    const artists = parseJson(search)?.artists;
    if (!Array.isArray(artists)) return { state: 'none' };
    const match = artists.find((a) => a && typeof a === 'object' && (Number(a.score) || 0) >= MIN_ARTIST_SCORE && normalize(textOf(a.name)) === key && textOf(a.id));
    if (!match) return { state: 'none' };

    // 2. MusicBrainz: de verwijzing naar Wikidata
    const rels = await this.musicBrainz(`https://musicbrainz.org/ws/2/artist/${encodeURIComponent(match.id)}?inc=url-rels&fmt=json`);
    if (rels.status === 'failed') return { state: 'failed' };
    const relations = parseJson(rels)?.relations;
    if (!Array.isArray(relations)) return { state: 'none' };
    let wikidataId = '';
    for (const relation of relations) {
      if (!relation || relation.type !== 'wikidata') continue;
      const id = textOf(relation.url?.resource).split('/').pop();
      if (/^Q\d+$/.test(id)) { wikidataId = id; break; }
    }
    if (!wikidataId) return { state: 'none' };

    // 3. Wikidata: de bestandsnaam van de foto (eigenschap P18); alleen die eigenschap wordt opgevraagd
    const claims = await this.fetchBytes(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wikidataId}&property=P18&format=json`, { maxBytes: MAX_TEXT });
    if (claims.status === 'failed') return { state: 'failed' };
    const fileName = textOf(parseJson(claims)?.claims?.P18?.[0]?.mainsnak?.datavalue?.value).trim();
    if (!fileName) return { state: 'none' };

    // 4. Wikimedia Commons: de foto zelf, op 500 punten breed
    const image = await this.fetchBytes(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=500`);
    if (image.status === 'failed') return { state: 'failed' };
    return image.body && image.body.length ? { state: 'found', bytes: image.body } : { state: 'none' };
  }

  async fromDeezer(name, key) {
    const search = await this.fetchBytes(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`, { maxBytes: MAX_TEXT });
    if (search.status === 'failed') return { state: 'failed' };
    const data = parseJson(search)?.data;
    if (!Array.isArray(data)) return { state: 'none' };
    let pictureUrl = '';
    for (const artist of data) {
      if (!artist || typeof artist !== 'object' || normalize(textOf(artist.name)) !== key) continue;
      // De standaardafbeelding van Deezer voor een artiest zonder foto heeft een leeg stuk in het adres ("/artist//").
      const candidate = ['picture_big', 'picture_xl', 'picture_medium']
        .map((field) => textOf(artist[field]))
        .find((value) => value.trim() && !value.includes('/artist//') && isDeezerImage(value));
      if (candidate) { pictureUrl = candidate; break; }
    }
    if (!pictureUrl) return { state: 'none' };
    const image = await this.fetchBytes(pictureUrl);
    if (image.status === 'failed') return { state: 'failed' };
    return image.body && image.body.length ? { state: 'found', bytes: image.body } : { state: 'none' };
  }
}

function artistNames(credits) {
  const names = [];
  for (const credit of Array.isArray(credits) ? credits : []) {
    if (!credit || typeof credit !== 'object') continue;
    if (textOf(credit.name)) names.push(credit.name);
    if (textOf(credit.artist?.name)) names.push(credit.artist.name);
  }
  return names;
}

// De naam van de artiest moet kloppen, zodat een gelijknamig nummer geen verkeerde hoes geeft.
function artistMatches(recording, wanted) {
  const found = normalize(artistNames(recording['artist-credit']).join(' '));
  return wanted !== '' && (found.includes(wanted) || wanted.includes(found));
}

// "Various Artists" als artiest van de release: een verzamelaar, ook als MusicBrainz hem niet zo heeft getypeerd.
function isVariousArtists(release) {
  return artistNames(release['artist-credit']).some((n) => normalize(n) === 'variousartists');
}
