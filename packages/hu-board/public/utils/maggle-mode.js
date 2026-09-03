// KJC-TSK-0810 (MGL-C) — maggle mode: the board in plain language.
//
// Classic script (no exports), loaded FIRST among the utils so the other
// scripts can call maggleText() at render time. `kj go` opens the board at
// /?maggle=1; the choice persists in localStorage so reloads keep the
// plain-language UI, and ?maggle=0 (the "modo experto" link) clears it.
// A dev opening the board directly sees no change. If storage is
// unavailable the mode degrades to the technical UI — it never breaks.

const MAGGLE_STORE_KEY = 'kj-maggle-mode';

// Plain label first; the technical term survives as tooltip/secondary
// detail where each call site renders it (AC1: llano delante, jerga detrás).
const MAGGLE_LABELS = {
  'column.pending': 'Por hacer',
  'column.running': 'En marcha',
  'column.done': 'Hecho',
  'board.title': 'Tu trabajo',
  'board.stories': 'tareas',
  'board.story': 'tarea',
  'board.run': '▶ Continuar con lo pendiente',
  'board.runTitle': 'Karajan seguirá con las tareas que faltan, una a una. Podrás ver la actividad aquí.',
  'board.stop': '⏹ Parar',
  'board.stopTitle': 'Detiene el trabajo en marcha. Lo ya terminado se conserva.',
  'board.viewLog': '📜 Ver actividad',
  'board.running': 'en marcha',
  'board.ragPlaceholder': '🔍 Pregunta lo que quieras sobre este proyecto…',
  'header.subtitle': 'tu tablero de trabajo',
  'nav.board': 'Tablero',
  'nav.dashboard': 'Proyectos',
  'nav.more': 'Más',
};

function isMaggleMode() {
  try {
    const flag = new URLSearchParams(location.search || '').get('maggle');
    if (flag === '1') { localStorage.setItem(MAGGLE_STORE_KEY, '1'); return true; }
    if (flag === '0') { localStorage.removeItem(MAGGLE_STORE_KEY); return false; }
    return localStorage.getItem(MAGGLE_STORE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Plain label when maggle mode is on; the technical one otherwise. */
function maggleText(key, technical) {
  if (!isMaggleMode()) return technical;
  return MAGGLE_LABELS[key] || technical;
}

// Minimal chrome for this step: mark the body (CSS hook) and put the
// subtitle in plain language. Folding the advanced nav behind "Más" is
// AC2 and ships with the launcher step (PR-C2 of KJC-TSK-0810).
function applyMaggleChrome() {
  if (!isMaggleMode()) return;
  document.body.classList.add('maggle-mode');
  const subtitle = document.querySelector('.header__subtitle');
  if (subtitle) subtitle.textContent = MAGGLE_LABELS['header.subtitle'];
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('DOMContentLoaded', applyMaggleChrome);
}
