// Inloggen: wie ben je (de beheerder of een gebruiker), een ondertekende cookie als bewijs, en de begrenzing tegen raden.
// Het beheerderswachtwoord staat in ADMIN_PASSWORD; zonder dat wachtwoord is inloggen uit en blijft alles open, zoals voor
// de komst van accounts. De cookie bevat het account, de "sessieversie" van dat account en een einddatum, met een
// handtekening die alleen deze server kan maken. Verandert een wachtwoord, wordt een account uitgeschakeld of kies je
// "overal uitloggen", dan klopt de sessieversie niet meer en zijn alle oude cookies meteen waardeloos.
import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ADMIN_NAME } from './users.js';

const SHORT_SESSION_MS = 24 * 60 * 60 * 1000; // zonder "ingelogd blijven": één dag, en weg zodra de browser sluit

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

/** Telt mislukte pogingen per sleutel (adres of gebruikersnaam) binnen een tijdvenster; het geheugen blijft klein. */
class FailCounter {
  constructor(max, windowMs, maxKeys = 5000) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.map = new Map();
  }

  recent(key, now) {
    return (this.map.get(key) || []).filter((t) => now - t < this.windowMs);
  }

  tooMany(key, now = Date.now()) {
    return this.recent(key, now).length >= this.max;
  }

  add(key, now = Date.now()) {
    const list = this.recent(key, now);
    list.push(now);
    this.map.delete(key);
    this.map.set(key, list);
    if (this.map.size > this.maxKeys) this.map.delete(this.map.keys().next().value);
  }

  clear(key) {
    this.map.delete(key);
  }
}

export class Auth {
  constructor(config, users) {
    this.password = config.adminPassword;
    this.days = config.sessionDays;
    this.cookie = config.cookieName;
    this.users = users;
    this.secret = this.loadSecret(config);
    this.byAddress = new FailCounter(5, 5 * 60 * 1000);
    this.byName = new FailCounter(10, 15 * 60 * 1000);
  }

  loadSecret(config) {
    if (config.sessionSecret) return config.sessionSecret;
    // Zonder SESSION_SECRET: een eigen geheim in de data-map, zodat je ingelogd blijft na een herstart.
    const file = path.join(config.dataDir, 'secret');
    try {
      return readFileSync(file, 'utf8').trim();
    } catch {
      const secret = randomBytes(32).toString('hex');
      try {
        mkdirSync(config.dataDir, { recursive: true });
        writeFileSync(file, secret + '\n', { mode: 0o600 });
      } catch {
        // alleen in het geheugen: na een herstart opnieuw inloggen
      }
      return secret;
    }
  }

  get enabled() {
    return this.password !== '';
  }

  sign(payload) {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  /** De sessieversie van de beheerder: verandert met ADMIN_PASSWORD en met "overal uitloggen". */
  adminVersion() {
    return this.sign(`admin-versie:${digest(this.password).toString('hex')}:${this.users.adminEpoch}`).slice(0, 12);
  }

  static cleanName(value) {
    return String(value ?? ADMIN_NAME).trim().toLowerCase().slice(0, 64);
  }

  // ------------------------------------------------------------------ begrenzing

  /** Te vaak mis vanaf dit adres, of te vaak mis voor deze gebruikersnaam? */
  limited(ip, name, now = Date.now()) {
    return this.byAddress.tooMany(ip, now) || this.byName.tooMany(name, now);
  }

  fail(ip, name, now = Date.now()) {
    this.byAddress.add(ip, now);
    this.byName.add(name, now);
  }

  succeed(ip, name) {
    this.byAddress.clear(ip);
    this.byName.clear(name);
  }

  // ------------------------------------------------------------------ inloggen

  /**
   * Controleert naam en wachtwoord. Geeft { session } bij succes, { error: 'bad' } als het niet klopt (onbekende naam en fout
   * wachtwoord zijn niet van elkaar te onderscheiden) en { error: 'disabled' } als het wachtwoord klopt maar het account is uitgeschakeld.
   */
  async authenticate(name, password) {
    const pass = String(password ?? '');
    if (name === ADMIN_NAME) {
      const ok = timingSafeEqual(digest(pass), digest(this.password));
      return ok ? { session: { uid: ADMIN_NAME, name: ADMIN_NAME, role: 'admin' } } : { error: 'bad' };
    }
    const { user } = await this.users.check(name, pass);
    if (!user) return { error: 'bad' };
    if (user.disabled) return { error: 'disabled' };
    return { session: { uid: user.id, name: user.name, role: 'user' } };
  }

  // ------------------------------------------------------------------ cookie

  /** "<account>.<sessieversie>.<verloopt>.<handtekening>" */
  makeToken(session, { remember = true } = {}, now = Date.now()) {
    const version = session.uid === ADMIN_NAME ? this.adminVersion() : String(this.users.byId(session.uid)?.sv ?? 0);
    const expires = now + (remember ? this.days * 86400 * 1000 : SHORT_SESSION_MS);
    const body = `${session.uid}.${version}.${expires}`;
    return `${body}.${this.sign(body)}`;
  }

  /** Het account achter een cookiewaarde, of null als die vervalst, verlopen of ingetrokken is. */
  verifyToken(token, now = Date.now()) {
    if (!this.enabled || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const [uid, version, expires, signature] = parts;
    if (!/^\d+$/.test(expires)) return null;
    const a = Buffer.from(signature);
    const b = Buffer.from(this.sign(`${uid}.${version}.${expires}`));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    if (Number(expires) <= now) return null;
    if (uid === ADMIN_NAME) return version === this.adminVersion() ? { uid, name: ADMIN_NAME, role: 'admin' } : null;
    const user = this.users.byId(uid);
    if (!user || user.disabled || String(user.sv) !== version) return null;
    return { uid: user.id, name: user.name, role: 'user' };
  }

  static cookieFrom(header, name) {
    for (const part of String(header || '').split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === name) return rest.join('=');
    }
    return null;
  }

  sessionOf(req) {
    return this.verifyToken(Auth.cookieFrom(req.headers.cookie, this.cookie));
  }

  /** Is dit een cookie voor "ingelogd blijven" (einddatum meer dan een dag weg)? */
  isRemembered(req, now = Date.now()) {
    const token = Auth.cookieFrom(req.headers.cookie, this.cookie);
    const expires = Number(String(token || '').split('.')[2]);
    return Number.isFinite(expires) && expires - now > SHORT_SESSION_MS + 60 * 1000;
  }

  setCookie(token, { remember = true } = {}, secure = false) {
    const maxAge = remember ? `; Max-Age=${this.days * 86400}` : '';
    return `${this.cookie}=${token}; Path=/; HttpOnly; SameSite=Strict${maxAge}${secure ? '; Secure' : ''}`;
  }

  clearCookie(secure = false) {
    return `${this.cookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
  }
}
