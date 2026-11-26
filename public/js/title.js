// "Artiest - Titel" uit de ICY-metadata van een stream splitsen.
export function splitTitle(text) {
  if (!text) return ['', ''];
  const at = text.indexOf(' - ');
  return at > 0 ? [text.slice(0, at).trim(), text.slice(at + 3).trim()] : ['', text.trim()];
}
