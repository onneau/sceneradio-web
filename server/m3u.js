// M3U lezen, op dezelfde manier als M3uParser.kt in de app (HTML-tekens, ' en " als aanhaling, komma buiten aanhalingstekens).

function decodeEntities(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function attribute(line, key) {
  const double = new RegExp(`${key}="([^"]*)"`, 'i').exec(line);
  if (double) return decodeEntities(double[1].trim()) || null;
  const single = new RegExp(`${key}='([^']*)'`, 'i').exec(line);
  return single ? decodeEntities(single[1].trim()) || null : null;
}

function titleAfterComma(line) {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) return line.slice(i + 1).trim() || null;
  }
  return null;
}

/** [{ name, url, logo, group }] in de volgorde van de M3U. */
export function parseM3u(content) {
  const stations = [];
  let name = null;
  let logo = null;
  let group = null;
  for (const raw of String(content).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.toUpperCase().startsWith('#EXTINF:')) {
      logo = attribute(line, 'tvg-logo');
      group = attribute(line, 'group-title');
      const tvgName = attribute(line, 'tvg-name');
      const title = titleAfterComma(line);
      name = (title ? decodeEntities(title) : null) || tvgName || 'Onbekend Station';
    } else if (!line.startsWith('#')) {
      if (/^(https?|mms|rtsp):\/\//i.test(line)) {
        stations.push({ name: name ?? `Station ${stations.length + 1}`, url: line, logo, group: group ?? 'Algemeen' });
      }
      name = null;
      logo = null;
      group = null;
    }
  }
  return stations;
}

export function splitGenres(value) {
  const seen = new Set();
  const out = [];
  for (const part of String(value ?? '').split(';')) {
    const genre = part.trim();
    if (genre && !seen.has(genre.toLowerCase())) {
      seen.add(genre.toLowerCase());
      out.push(genre);
    }
  }
  return out;
}

/** "logos/x.jpg?v=ab12cd34" -> { path: "logos/x.jpg", version: "ab12cd34" }; een http-logo blijft een URL. */
export function parseLogoRef(raw) {
  const logo = String(raw ?? '').trim();
  if (!logo) return null;
  if (/^https?:\/\//i.test(logo)) return { url: logo, version: '' };
  if (logo.includes('://') || logo.includes('..')) return null;
  const clean = logo.replace(/^\.\//, '').replace(/^\/+/, '');
  const [pathPart, query = ''] = clean.split('?', 2);
  const version = query.split('&').find((p) => p.startsWith('v='))?.slice(2) ?? '';
  return { path: pathPart, version };
}
