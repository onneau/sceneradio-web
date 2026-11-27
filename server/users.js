// De accounts: de beheerder (zijn wachtwoord staat in ADMIN_PASSWORD, niet in een bestand) en de gebruikers die de
// beheerder aanmaakt. Per account bewaart de server ook het profiel: favorieten, taal en weergave-instellingen
// (dezelfde opzet als de back-up, zie public/js/backup.js), zodat die op elk apparaat gelden. De server controleert alleen
// de vorm en de grootte; de pagina schoont de waarden zelf op met dezelfde regels als bij een back-up.
// Alles staat in de data-map: users.json (zonder leesbare wachtwoorden: alleen scrypt-hashes) en profiles/<id>.json.
import { scrypt, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const scryptAsync = promisify(scrypt);
const COST = { N: 16384, r: 8, p: 1 };
const KEY_BYTES = 64;
const MAX_MEM = 64 * 1024 * 1024;

export const ADMIN_NAME = 'admin';
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;
export const MAX_USERS = 100;
export const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const ID_PATTERN = /^u[0-9a-f]{12}$/;
const STATION_ID = /^[a-z0-9-]{1,100}$/;
const MAX_PROFILE_CHARS = 512 * 1024;
const MAX_FAVORITES = 5000;

/** Een fout met een melding voor de gebruiker (de server maakt er een HTTP-status van). */
export class AccountError extends Error {
  constructor(status, nl, en) {
    super(nl);
    this.status = status;
    this.nl = nl;
    this.en = en;
  }
}

async function derive(password, salt, { N, r, p }) {
  return scryptAsync(password, salt, KEY_BYTES, { N, r, p, maxmem: MAX_MEM });
}

/** "scrypt$N$r$p$zout$sleutel": het wachtwoord zelf is er niet uit terug te halen. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger) || N < 2 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;
  const expected = Buffer.from(parts[5], 'base64');
  if (expected.length !== KEY_BYTES) return false;
  const actual = await derive(password, Buffer.from(parts[4], 'base64'), { N, r, p });
  return timingSafeEqual(actual, expected);
}

/** Een wachtwoord dat je kunt doorbellen: 3 groepen van 4 tekens zonder lastige tekens (0/o, 1/l/i), ruim 55 bits. */
export function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const group = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

export function cleanName(value) {
  const name = String(value ?? '').trim().toLowerCase();
  if (name === ADMIN_NAME) throw new AccountError(400, 'De naam "admin" is gereserveerd voor de beheerder.', 'The name "admin" is reserved for the administrator.');
  if (!NAME_PATTERN.test(name)) {
    throw new AccountError(400, 'Kies een gebruikersnaam van 2 tot 32 tekens: kleine letters, cijfers, punt, streepje of underscore, beginnend met een letter of cijfer.',
      'Choose a username of 2 to 32 characters: lowercase letters, digits, dot, dash or underscore, starting with a letter or digit.');
  }
  return name;
}

export function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new AccountError(400, `Een wachtwoord heeft minstens ${MIN_PASSWORD} tekens.`, `A password has at least ${MIN_PASSWORD} characters.`);
  }
  if (password.length > MAX_PASSWORD) throw new AccountError(400, `Een wachtwoord heeft hooguit ${MAX_PASSWORD} tekens.`, `A password has at most ${MAX_PASSWORD} characters.`);
  return password;
}

export class Users {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'users.json');
    this.profileDir = path.join(dataDir, 'profiles');
    mkdirSync(this.profileDir, { recursive: true });
    const stored = this.read();
    this.users = Array.isArray(stored.users) ? stored.users.filter((u) => u && ID_PATTERN.test(u.id) && typeof u.name === 'string' && typeof u.hash === 'string') : [];
    this.adminEpoch = Number.isInteger(stored.adminEpoch) ? stored.adminEpoch : 0;
    this.adminLastLogin = typeof stored.adminLastLogin === 'string' ? stored.adminLastLogin : null;
    // Een hash waar nooit een wachtwoord bij past: een onbekende naam kost net zoveel tijd als een bekende.
    this.dummyHash = hashPassword(randomBytes(12).toString('hex'));
  }

  read() {
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8'));
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  save() {
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, adminEpoch: this.adminEpoch, adminLastLogin: this.adminLastLogin, users: this.users }, null, 2) + '\n', { mode: 0o600 });
    renameSync(temp, this.file);
  }

  byName(name) {
    return this.users.find((u) => u.name === name) || null;
  }

  byId(id) {
    return this.users.find((u) => u.id === id) || null;
  }

  /** Voor de beheerder: wat er over een account bekend is, zonder hash. */
  view(user) {
    return {
      id: user.id,
      name: user.name,
      role: 'user',
      disabled: Boolean(user.disabled),
      createdAt: user.createdAt || null,
      lastLogin: user.lastLogin || null,
      favorites: this.favoriteCount(user.id)
    };
  }

  list() {
    const admin = { id: ADMIN_NAME, name: ADMIN_NAME, role: 'admin', disabled: false, createdAt: null, lastLogin: this.adminLastLogin, favorites: this.favoriteCount(ADMIN_NAME) };
    return [admin, ...[...this.users].sort((a, b) => a.name.localeCompare(b.name)).map((u) => this.view(u))];
  }

  async create(name, password) {
    const clean = cleanName(name);
    checkPassword(password);
    if (this.users.length >= MAX_USERS) throw new AccountError(409, `Er kunnen hooguit ${MAX_USERS} gebruikers zijn.`, `There can be at most ${MAX_USERS} users.`);
    const hash = await hashPassword(password);
    // Pas hierna controleren: twee tegelijk aangemaakte namen kunnen elkaar niet meer inhalen.
    if (this.byName(clean)) throw new AccountError(409, 'Deze gebruikersnaam bestaat al.', 'This username already exists.');
    if (this.users.length >= MAX_USERS) throw new AccountError(409, `Er kunnen hooguit ${MAX_USERS} gebruikers zijn.`, `There can be at most ${MAX_USERS} users.`);
    const user = { id: `u${randomBytes(6).toString('hex')}`, name: clean, hash, sv: 1, disabled: false, createdAt: new Date().toISOString(), lastLogin: null };
    this.users.push(user);
    this.save();
    return this.view(user);
  }

  async setPassword(id, password) {
    checkPassword(password);
    const hash = await hashPassword(password);
    const user = this.byId(id);
    if (!user) throw new AccountError(404, 'Deze gebruiker bestaat niet (meer).', 'This user does not exist (any more).');
    user.hash = hash;
    user.sv += 1; // alle sessies van deze gebruiker zijn daarmee ongeldig
    this.save();
  }

  setDisabled(id, disabled) {
    const user = this.byId(id);
    if (!user) throw new AccountError(404, 'Deze gebruiker bestaat niet (meer).', 'This user does not exist (any more).');
    user.disabled = Boolean(disabled);
    user.sv += 1;
    this.save();
    return this.view(user);
  }

  remove(id) {
    const user = this.byId(id);
    if (!user) throw new AccountError(404, 'Deze gebruiker bestaat niet (meer).', 'This user does not exist (any more).');
    this.users = this.users.filter((u) => u.id !== id);
    this.save();
    try {
      unlinkSync(this.profilePath(id));
    } catch {
      // er was geen profiel
    }
  }

  /** Overal uitloggen: alle sessies van dit account vervallen. */
  logoutAll(id) {
    if (id === ADMIN_NAME) {
      this.adminEpoch += 1;
    } else {
      const user = this.byId(id);
      if (!user) return;
      user.sv += 1;
    }
    this.save();
  }

  touchLogin(id, now = new Date()) {
    if (id === ADMIN_NAME) this.adminLastLogin = now.toISOString();
    else {
      const user = this.byId(id);
      if (!user) return;
      user.lastLogin = now.toISOString();
    }
    this.save();
  }

  /** Klopt het wachtwoord van dit account? Geeft { user } (of { user: null } als er niets bij past) en kost altijd evenveel tijd. */
  async check(name, password) {
    const user = this.byName(name);
    const ok = await verifyPassword(password, user ? user.hash : await this.dummyHash);
    return { user: ok && user ? user : null };
  }

  // ------------------------------------------------------------------ profiel

  profilePath(id) {
    if (id !== ADMIN_NAME && !ID_PATTERN.test(id)) throw new Error('ongeldig account');
    return path.join(this.profileDir, `${id}.json`);
  }

  /** { updatedAt, backup } of null als er (nog) niets bewaard is. */
  getProfile(id) {
    try {
      const value = JSON.parse(readFileSync(this.profilePath(id), 'utf8'));
      if (value && Number.isFinite(value.updatedAt) && typeof value.backup === 'string') return { updatedAt: value.updatedAt, backup: value.backup };
    } catch {
      // geen of kapot bestand: alsof er niets is
    }
    return null;
  }

  favoriteCount(id) {
    const profile = this.getProfile(id);
    if (!profile) return 0;
    try {
      return JSON.parse(profile.backup).favorites.length;
    } catch {
      return 0;
    }
  }

  /** Controleert de vorm van het profiel en bewaart de schone versie. Geeft updatedAt (altijd hoger dan de vorige keer). */
  saveProfile(id, text, now = Date.now()) {
    const bad = (nl, en) => new AccountError(400, nl, en);
    if (typeof text !== 'string') throw bad('Dit profiel is geen geldige back-up.', 'This profile is not a valid backup.');
    if (text.length > MAX_PROFILE_CHARS) throw new AccountError(413, 'Het profiel is te groot.', 'The profile is too large.');
    let root;
    try {
      root = JSON.parse(text);
    } catch {
      throw bad('Dit profiel is geen geldige back-up.', 'This profile is not a valid backup.');
    }
    const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!plain(root) || root.format !== 'radio-backup' || root.platform !== 'web' || !Number.isInteger(root.formatVersion) || root.formatVersion < 1) {
      throw bad('Dit profiel is geen geldige back-up.', 'This profile is not a valid backup.');
    }
    const favorites = Array.isArray(root.favorites)
      ? [...new Set(root.favorites.filter((f) => typeof f === 'string' && STATION_ID.test(f)))].slice(0, MAX_FAVORITES)
      : [];
    const before = this.getProfile(id);
    if (before && now <= before.updatedAt) now = before.updatedAt + 1;
    const clean = JSON.stringify({
      format: 'radio-backup',
      formatVersion: root.formatVersion,
      platform: 'web',
      app: 'sync',
      createdAt: new Date(now).toISOString(),
      settings: plain(root.settings) ? root.settings : {},
      favorites,
      lastStation: typeof root.lastStation === 'string' && STATION_ID.test(root.lastStation) ? root.lastStation : null
    });
    const target = this.profilePath(id);
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ updatedAt: now, backup: clean }) + '\n', { mode: 0o600 });
    renameSync(temp, target);
    return now;
  }
}
