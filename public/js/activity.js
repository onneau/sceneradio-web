// Houdt bij of er iets gedaan wordt op de pagina (muis, tik, toets, scrollen). De speler gebruikt het om de bediening te
// verbergen en de visualizer te dimmen; main.js om vanuit de menu's terug te gaan naar de visualizer.
// Een muis die niet echt beweegt telt niet mee: Chrome stuurt soms nepbewegingen als de pagina onder een stilstaande muis verandert.
const MIN_MOVE = 3;   // beeldpunten
const listeners = new Set();
let lastX = -1000;
let lastY = -1000;

function seen(event) {
  if (event.type.startsWith('pointer')) {
    const moved = Math.abs(event.clientX - lastX) >= MIN_MOVE || Math.abs(event.clientY - lastY) >= MIN_MOVE;
    if (event.type === 'pointermove' && !moved) return;
    lastX = event.clientX;
    lastY = event.clientY;
  }
  for (const fn of listeners) fn(event);
}

for (const type of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll']) {
  document.addEventListener(type, seen, { passive: true, capture: true });
}

/** Roept `fn` aan bij elke echte activiteit. Geeft een functie terug die het weer stopt. */
export function onActivity(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
