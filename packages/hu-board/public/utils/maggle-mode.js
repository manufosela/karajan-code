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
  'picker.hint': 'Elige un proyecto para ver su tablero. Para cambiar de proyecto, vuelve a «Proyectos».',
  'picker.project': 'proyecto',
  'launcher.title': '📝 Pedir trabajo a Karajan',
  'launcher.planLabel': '📝 Pedir trabajo nuevo',
  'launcher.planHelp': 'Cuéntale a Karajan qué quieres construir o cambiar, con tus palabras. Lo convertirá en tareas que verás en el tablero — todavía no toca tu código.',
  'launcher.taskLabel': 'Qué quieres pedir',
  'launcher.submit': 'Pedir',
  'launcher.cancel': 'Cancelar',
  'launcher.more': 'Más opciones…',
  'launcher.confirm': 'Voy a convertir tu petición en tareas del tablero. Tardará unos minutos y podrás seguir la actividad en esta ventana. ¿Sigo?',
  'conversation.title': 'Habla con tu agente',
  'conversation.hide': 'Ocultar — la conversación sigue viva',
  'conversation.end': 'Terminar la sesión del agente',
  'log.label': 'Actividad',
  'log.connecting': 'conectando…',
  'log.footer': 'Cerrar esta ventana NO detiene el trabajo: sigue en marcha. Vuelve a abrirla con el botón «📜 Ver actividad» del tablero.',
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

// AC4: an error shown to a maggle is never a stacktrace alone. Pure —
// the caller (showError) decides by mode and renders the HTML.
function maggleErrorParts(rawMessage) {
  return {
    headline: 'Algo no ha salido como se esperaba',
    next: 'No has roto nada. Vuelve a intentarlo; si se repite, cuéntaselo a tu agente en la conversación — este detalle le sirve para arreglarlo.',
    detail: rawMessage,
  };
}

// AC2 (nav half): the header keeps Tablero + Proyectos in plain Spanish
// and folds every advanced view behind one "Más" toggle, which also
// reveals the way back to the expert UI.
function applyMaggleChrome() {
  if (!isMaggleMode()) return;
  document.body.classList.add('maggle-mode');
  const subtitle = document.querySelector('.header__subtitle');
  if (subtitle) subtitle.textContent = MAGGLE_LABELS['header.subtitle'];
  const nav = document.querySelector('.header__nav');
  if (!nav) return;
  const KEEP = { board: MAGGLE_LABELS['nav.board'], dashboard: MAGGLE_LABELS['nav.dashboard'] };
  const advanced = [];
  // KJC-TSK-0820: nav buttons live in TWO bars now — the generic header
  // and the project sub-bar (#project-nav). Fold both; Tablero stays in
  // the sub-bar so it only shows once a project is loaded.
  for (const btn of document.querySelectorAll('.header__nav .nav-btn, .project-nav .nav-btn')) {
    const view = btn.dataset.view;
    if (view && KEEP[view]) {
      btn.title = `${btn.textContent.trim()} — ${btn.title}`;
      btn.textContent = KEEP[view];
    } else {
      btn.style.display = 'none';
      advanced.push(btn);
    }
  }
  if (advanced.length === 0) return;
  const more = document.createElement('button');
  more.className = 'nav-btn';
  more.textContent = `${MAGGLE_LABELS['nav.more']} ▾`;
  more.title = 'Vistas avanzadas y volver al modo experto';
  more.addEventListener('click', () => {
    const hidden = advanced[0].style.display === 'none';
    for (const btn of advanced) btn.style.display = hidden ? '' : 'none';
    more.textContent = `${MAGGLE_LABELS['nav.more']} ${hidden ? '▴' : '▾'}`;
    let expert = document.getElementById('maggle-expert-link');
    if (hidden && !expert) {
      expert = document.createElement('a');
      expert.id = 'maggle-expert-link';
      expert.className = 'nav-btn';
      expert.href = '/?maggle=0';
      expert.textContent = 'Modo experto';
      expert.title = 'Vuelve a la interfaz técnica (Pending/Running/Done, comandos kj)';
      more.after(expert);
    } else if (!hidden && expert) {
      expert.remove();
    }
  });
  // In the GENERIC bar (before the control buttons), so the plain header
  // reads Proyectos | Más and the sub-bar keeps only Tablero.
  const controls = nav.querySelector('.header__controls');
  if (controls) controls.before(more);
  else nav.append(more);
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('DOMContentLoaded', applyMaggleChrome);
}
