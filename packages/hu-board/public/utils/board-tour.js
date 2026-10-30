// KJC-TSK-1198 — guided tour of the HU Board (driver.js, served from the dependency at
// /vendor/driver). It starts by itself the first time; the help modal relaunches it.
//
// Classic script (no exports). Globals consumed: window.driver.js (driver.js.iife.js).

const BOARD_TOUR_SEEN_KEY = 'kj-board-tour-seen';

// [selector, title, description, what to say when it is not on screen (else the step is skipped)]
const BOARD_TOUR = [
  ['[data-view="dashboard"]', 'Dashboard', 'Every project the board knows, with its stats. Click a project to open it.'],
  ['#help-btn', 'Help', 'A quick reference of each view, and this tour again whenever you want it.'],
  ['#config-btn', 'Settings', 'Configure Karajan: models, agents, iteration cap.'],
  ['#commands-btn', 'Commands', 'Launch a kj command (kj clean) and watch its log.'],
  ['#conversation-btn', 'Conversation', 'Your agent’s real terminal, inside the board.'],
  ['#restart-btn', 'Restart', 'Restart the board server. The page reconnects by itself.'],
  ['#sync-btn', 'Re-scan', 'Read the plans and sessions on disk again when something new is missing.'],
  ['#force-refresh-btn', 'Clean reload', 'Wipe the browser caches and reload, for when the page looks stale.'],
  ['#project-nav', 'Project bar', 'Board is the kanban of HUs, Graph who blocks whom, Sessions every kj run, Governance the rules and decision log, Pipeline the live runs, RAG the index of the code, Wiki the project docs.',
    'Open a project from the Dashboard: a bar appears with its views (Board, Graph, Sessions, Governance, Pipeline, RAG, Wiki).'],
  ['#preflight-panel', 'Project checks', 'Whether the project is ready to run: remote, clean tree, agents. Red means a blocker; open it to see why.'],
  ['#rag-panel', 'Search', 'Ask anything about the project’s plans, onboarding or code.'],
  ['#shared-board-notice [role="note"]', 'Shared board', 'These HUs are the team’s, from GitHub Issues: read-only here, changed with kj hu move.'],
  ['.kanban', 'Kanban', 'Pending, Running and Done. Click a card to see the HU in detail.'],
];

const isOnScreen = (selector) => {
  const el = document.querySelector(selector);
  return Boolean(el) && el.offsetParent !== null;
};

/** The tour for what is on screen now: absent elements are skipped or explained in the middle. */
function boardTourSteps() {
  return BOARD_TOUR.flatMap(([element, title, description, whenAbsent]) => {
    if (isOnScreen(element)) return [{ element, popover: { title, description } }];
    return whenAbsent ? [{ popover: { title, description: whenAbsent } }] : [];
  });
}

/** Run the whole tour; once closed or skipped, it does not start by itself again. */
function startBoardTour() {
  const tour = window.driver.js.driver({
    showProgress: true,
    allowKeyboardControl: true,
    steps: boardTourSteps(),
    onDestroyed: () => {
      try { localStorage.setItem(BOARD_TOUR_SEEN_KEY, '1'); }
      catch (err) { console.warn('board tour: cannot remember it was seen:', err.message); }
    },
  });
  tour.drive();
}

/** First visit only. A browser that cannot remember it never gets it by itself. */
function maybeStartFirstTour() {
  try {
    if (localStorage.getItem(BOARD_TOUR_SEEN_KEY)) return false;
  } catch {
    return false;
  }
  startBoardTour();
  return true;
}
