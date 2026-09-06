/**
 * Karajan HU Board - Frontend Application
 * Vanilla JS single-page app with hash-based routing.
 */

/**
 * Scoped-project mode: when the server serves `/p/<slug>`, the UI boots
 * pre-filtered to that project. Multi-project affordances (project
 * dropdown, Sessions tab, Pipeline link, Dashboard card grid) are hidden
 * because they make no sense here. Driven by dogfood feedback: the user
 * wanted one board per project, not a global view with 2 000 stories.
 */
const SCOPED_PREFIX = '/p/';
const scopedProjectSlug = window.location.pathname.startsWith(SCOPED_PREFIX)
  ? decodeURIComponent(window.location.pathname.slice(SCOPED_PREFIX.length)).replace(/\/+$/, '')
  : null;

if (scopedProjectSlug) {
  document.body.classList.add('scoped-mode');
}

/**
 * Current view — Board is the default everywhere, not just in scoped mode.
 * Dogfood quote: "Board vista por defecto. Dashboard es algo extra que a
 * priori no me interesa, pq me interesan los proyectos." The Kanban is
 * the thing the user wants to see first; Dashboard stays accessible via
 * its nav button for the (rare) multi-project overview case but is never
 * the landing view.
 */
let currentView = 'board';

/** @type {string} Selected project ID (empty = all) */
let selectedProject = scopedProjectSlug || '';

/** @type {number | null} Auto-refresh interval ID */
let refreshInterval = null;


// ---- Human-friendly story IDs ----
//
// Internal story IDs look like
//   home_manu_ws_ai_linux-assistant-orchestrator::hu_plan-20260424182640-4icc_003
// which is fine for disk and logs but terrible for humans. The UI shows a
// short form like `lao-003` (project initials + HU sequence) so the user
// can say "take a look at `lao-003`" instead of pasting the 82-char blob.
// The full ID stays accessible as a tooltip (and in the underlying data-id).

const projectInitialsCache = {};
const projectNameCache = {};
// KJC-PRP-0002 PR6: cache project.is_shared so the HU modal can gate the
// "Asignado a" field without re-fetching /api/projects/:id each open.
// 0/1 mirror what sqlite stores; undefined = not yet hydrated.
const projectIsSharedCache = {};


/**
 * Fetch-and-cache a project's metadata. Populates initialsCache and
 * nameCache in one trip so neither renderStoryCard nor the section
 * header has to await again. Falls back to the project id on any
 * failure so the UI never blocks on a network error.
 * @param {string} projectId
 * @returns {Promise<{ initials: string, name: string }>}
 */
async function resolveProjectMeta(projectId) {
  if (!projectId) return { initials: 'kj', name: '' };
  if (projectInitialsCache[projectId]) {
    return { initials: projectInitialsCache[projectId], name: projectNameCache[projectId] };
  }
  try {
    const project = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    const rawName = project.name || humaniseProjectName(projectId);
    const initials = deriveInitialsFromName(rawName);
    projectInitialsCache[projectId] = initials;
    projectNameCache[projectId] = rawName;
    projectIsSharedCache[projectId] = project.is_shared === 1 ? 1 : 0;
    return { initials, name: rawName };
  } catch {
    const fallbackName = humaniseProjectName(projectId);
    projectInitialsCache[projectId] = deriveInitialsFromName(fallbackName);
    projectNameCache[projectId] = fallbackName;
    projectIsSharedCache[projectId] = 0;
    return { initials: projectInitialsCache[projectId], name: fallbackName };
  }
}

/** Back-compat helper kept so existing callers don't break. */
async function resolveProjectInitials(projectId) {
  const meta = await resolveProjectMeta(projectId);
  return meta.initials;
}



/**
 * "Pick a project" view shown by the Board tab when nothing is
 * selected. Lists every project that has at least one HU with the
 * pending / running / done / failed counts — clicking takes the
 * user into that project's kanban (`#board/<slug>`).
 *
 * Why this instead of an "All projects" merged kanban: HU short ids
 * collide across projects (every project has a `*-001`), the column
 * counts become meaningless, and "missing test contract" warnings
 * apply to whatever-project so the user can't tell what to act on.
 * Forcing a project pick before the kanban is the cheapest way to
 * keep every other UI invariant honest.
 */

/**
 * Renders an empty state component.
 * @param {string} title
 * @param {string} text
 * @returns {string}
 */
function renderEmptyState(title, text) {
  return `
    <div class="empty-state">
      <div class="empty-state__title">${title || 'No data yet'}</div>
      <div class="empty-state__text">${text || 'HU stories and sessions will appear here as Karajan processes them.'}</div>
      <div class="empty-state__path">~/.karajan/hu-stories/</div>
    </div>
  `;
}

// ---- Plan execution ----
//
// The board delegates execution to the CLI via `POST /api/projects/:id/run`.
// There's no more intermediate "certify" step: the user reviews HUs
// (editing inline if needed — see edit-in-place PR), and when happy
// clicks "Run plan", which spawns `kj run --plan <id>` as a detached
// child on the server. Status updates flow back through the plan JSON
// watcher without any manual refresh.
//
// We still expose a per-HU status PATCH endpoint for corrective moves
// (e.g. retry a failed HU manually), but it's no longer the primary
// action on the card.

/**
 * Launch the pipeline over every plan of a project. Returns when the
 * spawn ack is received — not when the run completes. Live progress is
 * reflected automatically by the plans-dir watcher on the server, so
 * the board re-renders without us having to poll.
 * @param {string} projectId
 */
// Track the most recently launched planId so the "View log" button in
// the section header can re-open the viewer without the user hunting
// through plan ids.
let lastLaunchedPlanId = null;

// Generalised across plan runs AND ⚡ launcher commands: the ▶ Run
// plan button populates this with the run's logPath, and the
// command launcher does the same with its own commandId. The 📜
// View log button in the section header reads from here so it
// re-opens whichever was most recently launched.
let lastOpenedLog = null;     // { id, label, tailUrl(offset) }



// ---- Navigation ----

/**
 * Navigates to a specific view.
 * @param {string} view - 'dashboard', 'board', or 'sessions'
 */
function navigate(view) {
  currentView = view;
  // KJC-TSK-0820: going back to the Dashboard unloads the project — it is
  // the only place where a (different) project gets picked.
  if (view === 'dashboard' && !scopedProjectSlug) selectedProject = '';
  window.location.hash = selectedProject ? `${view}/${selectedProject}` : view;

  // Update active nav button
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  render();
}

/**
 * Selects a project and navigates to the board view.
 * @param {string} projectId
 */
function selectProject(projectId) {
  selectedProject = projectId;
  navigate('board');
}

/**
 * KJC-TSK-0820 — two-level nav. Which nav bars are visible: the generic
 * one always; the project sub-bar only while a project is loaded, and
 * never on the Dashboard (that's where projects get picked). Pure.
 * @param {string} view
 * @param {string} projectId
 * @returns {{ generic: boolean, project: boolean }}
 */
function projectNavVisibility(view, projectId) {
  return { generic: true, project: Boolean(projectId) && view !== 'dashboard' };
}

/**
 * Applies projectNavVisibility() to the DOM and stamps the loaded
 * project's name on the sub-bar.
 */
function updateProjectNav() {
  const bar = document.getElementById('project-nav');
  if (!bar) return;
  const visible = projectNavVisibility(currentView, selectedProject).project;
  bar.hidden = !visible;
  if (!visible) return;
  const nameEl = document.getElementById('project-nav-name');
  nameEl.textContent = projectNameCache[selectedProject] || humaniseProjectName(selectedProject);
  resolveProjectMeta(selectedProject).then((meta) => {
    if (meta.name) nameEl.textContent = meta.name;
  });
}

/**
 * Renders the current view.
 */
function render() {
  updateProjectNav();
  switch (currentView) {
    case 'dashboard': return renderDashboard();
    case 'board': return renderBoard();
    case 'sessions': return renderSessions();
    case 'graph': return renderGraph();
    case 'governance': return renderGovernance();
    default: return renderDashboard();
  }
}

/**
 * Parses the hash route and renders.
 */
function handleRoute() {
  // Board-first: the default landing view is always the Kanban. Dashboard
  // is only shown when the user explicitly navigates to `#dashboard`.
  const hash = window.location.hash.slice(1) || 'board';
  const parts = hash.split('/');
  // In scoped mode the project is locked — the hash controls the view
  // only. `board/<slug>` becomes `board` and the slug stays fixed.
  currentView = parts[0] || 'board';
  // Dashboard never carries a loaded project (KJC-TSK-0820): it is the
  // project picker, so a `#dashboard/<slug>` deep-link drops the slug.
  selectedProject = scopedProjectSlug
    || (currentView === 'dashboard' ? '' : parts[1] || '');

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === currentView);
  });

  render();
}

