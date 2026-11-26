// Streams doorgeven aan de browser.
import { pipeline } from 'node:stream';
import { httpGet, describeError, IcyStripper } from './net.js';



/**
 * Geeft de stream van een zender door aan de browser. Zo werken ook http-streams op een https-pagina, kan de
 * visualizer het geluid analyseren (zelfde herkomst) en komt de ICY-titel (artiest - titel) apart binnen.
 */
export async function proxyStream(req, res, url, { onTitle, onClose, allowPrivate = false } = {}) {
  const abort = new AbortController();
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    abort.abort();
    onClose?.();
  };
  res.on('close', finish);

  let upstream;
  try {
    ({ res: upstream } = await httpGet(url, {
      headers: { 'User-Agent': 'SceneRadioWeb/1.0', 'Icy-MetaData': '1', Accept: '*/*' },
      connectTimeout: 6000,
      headerTimeout: 12000,
      allowPrivate,
      signal: abort.signal
    }));
  } catch (error) {
    if (closed) return;
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: describeError(error) }));
    } else {
      res.destroy();
    }
    return;
  }

  if (closed) {
    upstream.destroy();
    return;
  }
  const status = upstream.statusCode || 0;
  const contentType = String(upstream.headers['content-type'] || '');
  if (status !== 200 && status !== 206) {
    upstream.destroy();
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: `HTTP ${status}` }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentType || 'audio/mpeg',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'none'
  });

  const metaint = Number.parseInt(String(upstream.headers['icy-metaint'] || ''), 10);
  const done = () => finish();
  if (Number.isFinite(metaint) && metaint > 0) {
    pipeline(upstream, new IcyStripper(metaint, (title) => onTitle?.(title)), res, done);
  } else {
    pipeline(upstream, res, done);
  }
}
