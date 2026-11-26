// Uitgaande HTTP-verzoeken (streams, logo's) met time-outs, redirects en een beveiliging tegen verzoeken naar
// het eigen netwerk, plus het uit de audio halen van ICY-metadata (artiest - titel).
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { Transform } from 'node:stream';
import { tr } from './i18n.js';

export class FetchError extends Error {
  constructor(message, code = '') {
    super(message);
    this.name = 'FetchError';
    this.code = code;
  }
}

/** Loopback, privé-, link-local- en andere niet-publieke adressen. */
export function isPrivateAddress(address) {
  let ip = String(address).toLowerCase();
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) ip = mapped[1];
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (net.isIPv6(ip)) {
    return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  }
  return true;
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (error, address, family) => {
    if (error) return callback(error);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (list.some((entry) => isPrivateAddress(entry.address))) {
      return callback(new FetchError(tr('Adres in het eigen netwerk is niet toegestaan.', 'Address in the local network is not allowed.'), 'PRIVATE'));
    }
    return callback(null, address, family);
  });
}

/** Een korte reden voor in de lijst (Nederlands of Engels naar het verzoek); dezelfde teksten als de app. */
export function describeError(error) {
  const code = error?.code || error?.cause?.code || '';
  if (code === 'PRIVATE') return tr('Adres in eigen netwerk niet toegestaan', 'Address in local network not allowed');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return tr('Host onbekend (DNS)', 'Unknown host (DNS)');
  if (code === 'ECONNREFUSED') return tr('Verbinding geweigerd', 'Connection refused');
  if (code === 'ETIMEDOUT' || code === 'TIMEOUT' || code === 'ESOCKETTIMEDOUT') return tr('Time-out', 'Timed out');
  if (/^(CERT_|ERR_TLS|DEPTH_ZERO|UNABLE_TO_|SELF_SIGNED|EPROTO|ERR_SSL)/.test(code) || /tls|ssl|certificate/i.test(error?.message || '')) {
    return tr('TLS-fout', 'TLS error');
  }
  if (error instanceof FetchError && error.message) return error.message;
  return tr('Verbinding mislukt', 'Connection failed');
}

/**
 * GET met redirects. Geeft { res, url } terug; `res` is het (nog niet gelezen) antwoord.
 * connectTimeout: tot het adres verbonden is; headerTimeout: tot de statusregel en headers binnen zijn.
 */
export function httpGet(urlString, options = {}) {
  const {
    headers = {},
    connectTimeout = 5000,
    headerTimeout = 10000,
    maxRedirects = 5,
    allowPrivate = false,
    signal
  } = options;

  return new Promise((resolve, reject) => {
    let redirects = 0;
    let current;
    try {
      current = new URL(urlString);
    } catch {
      return reject(new FetchError(tr('Ongeldige URL', 'Invalid URL'), 'BADURL'));
    }

    const attempt = (target) => {
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return reject(new FetchError(tr('Alleen http en https', 'Only http and https'), 'BADURL'));
      }
      // Een IP-adres in de URL wordt niet via DNS opgezocht, dus dat controleren we hier zelf (bij elke redirect opnieuw).
      const literal = target.hostname.replace(/^\[|\]$/g, '');
      if (!allowPrivate && net.isIP(literal) && isPrivateAddress(literal)) {
        return reject(new FetchError(tr('Adres in het eigen netwerk is niet toegestaan.', 'Address in the local network is not allowed.'), 'PRIVATE'));
      }
      const client = target.protocol === 'https:' ? https : http;
      const request = client.request(
        target,
        { method: 'GET', headers, lookup: allowPrivate ? undefined : guardedLookup, signal },
        (res) => {
          clearTimeout(headerTimer);
          const status = res.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
            res.resume();
            if (++redirects > maxRedirects) return reject(new FetchError(tr('Te veel redirects', 'Too many redirects'), 'REDIRECTS'));
            try {
              current = new URL(res.headers.location, target);
            } catch {
              return reject(new FetchError(tr('Ongeldige redirect', 'Invalid redirect'), 'BADURL'));
            }
            return attempt(current);
          }
          return resolve({ res, url: target });
        }
      );
      const headerTimer = setTimeout(() => request.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), headerTimeout);
      request.on('socket', (socket) => {
        if (!socket.connecting) return;
        const connectTimer = setTimeout(() => request.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), connectTimeout);
        socket.once('connect', () => clearTimeout(connectTimer));
        socket.once('close', () => clearTimeout(connectTimer));
      });
      request.on('error', (error) => {
        clearTimeout(headerTimer);
        reject(error);
      });
      request.end();
    };
    attempt(current);
  });
}

/** Leest een antwoord helemaal, maar niet verder dan `maxBytes`. */
export function readLimited(res, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    res.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        res.destroy();
        reject(new FetchError(tr('Bestand is te groot', 'File is too large'), 'TOOBIG'));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
    res.on('aborted', () => reject(new FetchError(tr('Verbinding verbroken', 'Connection lost'), 'ABORTED')));
  });
}

/** "StreamTitle='Artiest - Titel';StreamUrl='';" -> "Artiest - Titel" */
export function parseIcyTitle(buffer) {
  let text = buffer.toString('utf8');
  if (text.includes('�')) text = buffer.toString('latin1');
  const match = text.match(/StreamTitle='(.*?)'(?:;|\0|$)/s);
  if (!match) return null;
  const title = match[1].replace(/\0+$/g, '').trim();
  return title === '' ? null : title.slice(0, 300);
}

/**
 * Haalt de ICY-metadata uit een audiostroom: elke `metaint` bytes audio volgt een lengtebyte (x16) en dan
 * de metadata. Alleen de audio gaat door naar de browser; de titel gaat naar `onTitle`.
 */
export class IcyStripper extends Transform {
  constructor(metaint, onTitle) {
    super();
    this.metaint = metaint;
    this.onTitle = onTitle;
    this.state = 'audio';
    this.left = metaint;
    this.meta = [];
  }

  _transform(chunk, _encoding, callback) {
    let pos = 0;
    while (pos < chunk.length) {
      if (this.state === 'audio') {
        const n = Math.min(this.left, chunk.length - pos);
        if (n > 0) this.push(chunk.subarray(pos, pos + n));
        pos += n;
        this.left -= n;
        if (this.left === 0) this.state = 'length';
      } else if (this.state === 'length') {
        const length = chunk[pos++] * 16;
        if (length === 0) {
          this.state = 'audio';
          this.left = this.metaint;
        } else {
          this.state = 'meta';
          this.left = length;
          this.meta = [];
        }
      } else {
        const n = Math.min(this.left, chunk.length - pos);
        this.meta.push(chunk.subarray(pos, pos + n));
        pos += n;
        this.left -= n;
        if (this.left === 0) {
          const title = parseIcyTitle(Buffer.concat(this.meta));
          if (title !== null) this.onTitle(title);
          this.state = 'audio';
          this.left = this.metaint;
        }
      }
    }
    callback();
  }
}
