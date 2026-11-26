// Praat met de server. Fouten krijgen de melding van de server mee; die komt in de taal van X-Lang.
import { lang, tr } from './i18n.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}


async function parse(response) {
  const type = response.headers.get('content-type') || '';
  if (type.includes('json')) return response.json();
  return null;
}

export async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Lang': lang(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(tr('Geen verbinding met de server.', 'No connection to the server.'), 0);
  }
  const data = await parse(response);
  if (!response.ok) {
    throw new ApiError(data?.error || tr(`Fout ${response.status}`, `Error ${response.status}`), response.status);
  }
  return data;
}

