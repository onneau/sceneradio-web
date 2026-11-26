// Taal van de pagina, zoals in de apps: tr('Nederlands', 'English'). De keuze (volg de browser, Nederlands of English)
// staat in deze browser (localStorage 'ew.lang'). De pagina laat elke tekst opnieuw tekenen als de taal wisselt.
const KEY = 'ew.lang';

function stored() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'nl' || value === 'en' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

let setting = stored();

/** 'auto' | 'nl' | 'en': wat de bezoeker heeft gekozen. */
export function langSetting() {
  return setting;
}

/** De taal die nu geldt: 'nl' of 'en'. "Volg de browser" is Nederlands voor een Nederlandse browser, anders Engels. */
export function lang() {
  if (setting !== 'auto') return setting;
  const first = (navigator.languages && navigator.languages[0]) || navigator.language || 'nl';
  return /^nl\b/i.test(first) ? 'nl' : 'en';
}


/** De Nederlandse of Engelse tekst, naar de taal van nu. */
export function tr(nl, en) {
  return lang() === 'en' ? en : nl;
}

/** Taalcode voor datums en tijden. */
export function locale() {
  return lang() === 'en' ? 'en-GB' : 'nl-NL';
}

export function applyLang() {
  document.documentElement.lang = lang();
}

export function setLangSetting(value) {
  setting = value === 'nl' || value === 'en' ? value : 'auto';
  try {
    if (setting === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, setting);
  } catch {
    // opslag geblokkeerd: de keuze geldt dan tot de pagina wordt vernieuwd
  }
  applyLang();
  document.dispatchEvent(new CustomEvent('ew:lang'));
}

applyLang();
