// Praat met de server. Fouten krijgen de melding van de server mee; die komt in de taal van X-Lang.
import { lang, tr } from './i18n.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function parse(response) {
  const type = response.headers.get('content-type') || '';
  if (type.includes('json')) return response.json();
  return null;
}

/** `keepalive`: het verzoek mag doorlopen als de pagina sluit (voor het bewaren van je profiel). */
export async function api(path, { method = 'GET', body, keepalive = false } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Lang': lang(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      keepalive
    });
  } catch {
    throw new ApiError(tr('Geen verbinding met de server.', 'No connection to the server.'), 0);
  }
  const data = await parse(response);
  if (!response.ok) {
    if (response.status === 401 && !path.endsWith('/login')) onUnauthorized();
    throw new ApiError(data?.error || tr(`Fout ${response.status}`, `Error ${response.status}`), response.status);
  }
  return data;
}

