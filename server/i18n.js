// Taal van de server-meldingen: de pagina stuurt bij elk verzoek `X-Lang: nl|en` mee. Zonder die kop kijken we naar
// Accept-Language en vallen we terug op Nederlands. De taal hoort bij het verzoek (AsyncLocalStorage), zodat
// diepe functies geen taalparameter hoeven door te geven. Logregels van de server blijven Nederlands.
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/** 'nl' of 'en' voor dit verzoek. */
export function langOf(req) {
  const explicit = String(req.headers['x-lang'] || '').toLowerCase();
  if (explicit === 'nl' || explicit === 'en') return explicit;
  const accept = String(req.headers['accept-language'] || '').trim().toLowerCase();
  return /^en\b/.test(accept) ? 'en' : 'nl';
}

export function runWithLang(lang, fn) {
  return storage.run(lang === 'en' ? 'en' : 'nl', fn);
}

export function currentLang() {
  return storage.getStore() || 'nl';
}

/** Beide talen bewaren, voor een melding die later aan iemand anders (in een andere taal) getoond kan worden. */
export function both(nl, en) {
  return { nl, en };
}

/** De tekst uit `both()` in de taal van het lopende verzoek; een gewone tekst blijft zoals hij is. */
export function pick(message) {
  if (message && typeof message === 'object') return currentLang() === 'en' ? message.en : message.nl;
  return message;
}

/** De Nederlandse of Engelse tekst, naar de taal van het lopende verzoek. */
export function tr(nl, en) {
  return currentLang() === 'en' ? en : nl;
}
