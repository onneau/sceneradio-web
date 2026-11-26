// Namen en fouten voor de zenderlijst: slugify() is dezelfde als in generate_m3u.py van de lijst en in de Android-app.
import { pick } from './i18n.js';

/** Zelfde als slugify() in generate_m3u.py: NFKD, alleen ASCII, kleine letters, rest wordt een streepje. */
export function slugify(name) {
  const ascii = String(name).normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase();
  const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'station';
}


export class RepoError extends Error {
  /** `message`: een tekst of een `both(nl, en)`; zo kan een bewaarde fout later in de taal van de lezer worden getoond. */
  constructor(message, code = 0) {
    super(pick(message));
    this.name = 'RepoError';
    this.code = code;
    this.texts = message && typeof message === 'object' ? message : { nl: message, en: message };
  }
}

