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

// Format helpers (formatHHMM, shortTask, formatSessionLabel) live in
// /utils/formatters.js — loaded as a classic script before this file by
// index.html. KJC-TSK-0501 (step 1/8) moved them out of here so they're
// reusable from future split modules. packages/hu-board/src/format.js
// still owns the Node-side duplicates for tests.

// API layer (api / triggerSync), standby banner polling and server-restart
// detector (pollServerVersion / window.forceRefresh) live in
// utils/api.js (KJC-TSK-0501 step 3/8).

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

// humaniseProjectName + deriveInitialsFromName moved to utils/formatters.js
// (KJC-TSK-0501 step 1/8).

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

// shortStoryId + timeAgo + formatDuration + scoreClass + qualityBar + esc
// + EPHEMERAL_HEURISTIC_RE + isTestIcon + isTestTitle + truncate moved to
// utils/formatters.js (KJC-TSK-0501 step 1/8).

// ---- Render Functions ----

// renderDashboard moved to utils/dashboard-view.js (KJC-TSK-0501 step 6/8).

// renderBoard moved to utils/board-view.js (KJC-TSK-0501 step 5/8).

// DAG view (renderGraph + helpers + constants) moved to utils/graph-view.js (KJC-TSK-0501 step 6/8).

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
// renderProjectPicker moved to utils/project-picker-view.js (KJC-TSK-0501 step 7/8).

// renderKanbanColumn moved to utils/board-view.js (KJC-TSK-0501 step 5/8).

// renderStoryCard moved to utils/board-view.js (KJC-TSK-0501 step 5/8).

// computeEffectiveResult moved to utils/board-view.js (KJC-TSK-0501 step 5/8).

// renderResultBadge moved to utils/board-view.js (KJC-TSK-0501 step 5/8).

// renderOutcomeChip moved to utils/board-view.js (KJC-TSK-0501 step 5/8).

// renderSessions + renderSessionCard moved to utils/sessions-view.js (KJC-TSK-0501 step 4/8).

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

// Preflight + runProject moved to utils/run-launcher.js (KJC-TSK-0501 step 8f/8).
// renderPreflightPanel moved to utils/preflight-view.js (KJC-TSK-0501 step 7/8).

// HU action handlers (runSingleHuFromCard, changeHuStatusFromModal,
// saveHuModels, saveHuAssignee, undoHuChanges, resetHuToPending) moved
// to utils/hu-actions.js (KJC-TSK-0501 step 8a/8).

// renameProjectModal + showOutcomeModal moved to utils/project-actions.js
// (KJC-TSK-0501 step 8b/8).

// renderPlanRollup moved to utils/plan-rollup-view.js (KJC-TSK-0501 step 7/8).

// Run log viewer (openLogViewer, openGenericLogPanel, winBtnStyle,
// logPollTimer, logViewerState) moved to utils/log-panel.js
// (KJC-TSK-0501 step 7/8). ANSI helpers live in utils/formatters.js.

// ---- Detail Modals ----

/**
 * Shows the story detail modal.
 * @param {string} storyId
 */
// showStoryDetail moved to utils/story-detail-view.js (KJC-TSK-0501 step 7/8).

// renderStoryEditForm + saveStoryEdits moved to utils/story-edit-form.js (KJC-TSK-0501 step 8c/8).

// showSessionDetail moved to utils/sessions-view.js (KJC-TSK-0501 step 4/8).

// closeModal + native dialog helpers (ensureDialog/showError/showConfirm/showHelp) live in utils/modals.js (KJC-TSK-0501 step 2/8).

// ---- Navigation ----

/**
 * Navigates to a specific view.
 * @param {string} view - 'dashboard', 'board', or 'sessions'
 */
function navigate(view) {
  currentView = view;
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
  document.getElementById('project-select').value = projectId;
  navigate('board');
}

/**
 * Renders the current view.
 */
function render() {
  switch (currentView) {
    case 'dashboard': return renderDashboard();
    case 'board': return renderBoard();
    case 'sessions': return renderSessions();
    case 'graph': return renderGraph();
    default: return renderDashboard();
  }
}

/**
 * Populates the project selector dropdown.
 */
async function populateProjectSelect() {
  try {
    const projects = await api('/api/projects');
    const select = document.getElementById('project-select');
    // Which project should appear pre-selected? Order:
    //   1. scopedProjectSlug (URL is /p/<slug>)  — locked, never changes
    //   2. selectedProject (route state, ej. #board/<slug>)
    //   3. ""                                    — "All Projects"
    // PR-D: the previous version cleared innerHTML and never marked
    // any option as selected, so the dropdown showed "All Projects"
    // even when scoped to one. handleRoute() set .value separately
    // BUT the value was lost in the race because the matching option
    // didn't exist yet when handleRoute ran. Setting .selected on
    // the option directly avoids the race.
    const desired = scopedProjectSlug || selectedProject || '';
    select.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All Projects';
    if (desired === '') all.selected = true;
    select.appendChild(all);
    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      if (p.id === desired) opt.selected = true;
      select.appendChild(opt);
    }
    // Final guard: if `desired` did not match any rendered option
    // (project not on the board yet), still set the value so
    // handleRoute's expectation holds.
    if (desired) select.value = desired;
  } catch {
    // Silently fail — project list will be empty
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
  selectedProject = scopedProjectSlug || parts[1] || '';

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === currentView);
  });

  document.getElementById('project-select').value = selectedProject;
  render();
}

// showCommandLauncher moved to utils/command-launcher.js (KJC-TSK-0501 step 8e/8).
// showConfigEditor moved to utils/config-editor.js (KJC-TSK-0501 step 8d/8).


// openCommandLogViewer moved to utils/command-launcher.js (KJC-TSK-0501 step 8e/8).

// ---- Initialization ----

// Nav button clicks
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => navigate(btn.dataset.view));
});

// Project selector
document.getElementById('project-select').addEventListener('change', (e) => {
  selectedProject = e.target.value;
  window.location.hash = selectedProject ? `${currentView}/${selectedProject}` : currentView;
  render();
});

// Sync button — re-scan disk for new batches
document.getElementById('sync-btn').addEventListener('click', async () => {
  const btn = document.getElementById('sync-btn');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    await fetch('/api/sync', { method: 'POST' });
    await populateProjectSelect();
    render();
  } catch { /* ignore */ }
  btn.textContent = '🔄';
  btn.disabled = false;
});

// Commands button — opens the launcher modal so the user can run
// `kj plan`, `kj architect`, `kj clean` (and more later) without
// dropping to a terminal. Output streams to the existing log panel.
document.getElementById('commands-btn').addEventListener('click', () => {
  showCommandLauncher();
});

// Help button — KJC-TSK-0372. Quick reference modal for the 5 views.
// Hover tooltips on each tab cover the 1-line case; this modal is
// for users who arrive cold and want "ok, what does each one do?".
document.getElementById('help-btn').addEventListener('click', () => {
  showHelp();
});

// PR5: Settings button — opens the kj.config.yml editor modal.
// User picks coder/reviewer providers, model strategy, iteration
// caps, etc. in plain Spanish. Save writes the yml atomically;
// next `kj run` picks up the new config (no restart needed).
document.getElementById('config-btn').addEventListener('click', () => {
  showConfigEditor();
});

// Restart button — respawn the board server in place. The page's
// EventSource auto-reconnects so the user sees a brief "connecting…"
// blip and the board comes back live.
document.getElementById('restart-btn').addEventListener('click', async () => {
  const ok = await showConfirm(
    'Restart the HU Board server now? The page will reconnect automatically.',
    { title: 'Restart board', okLabel: 'Restart' }
  );
  if (!ok) return;
  try {
    await fetch('/api/board/restart', { method: 'POST' });
  } catch { /* the server is going down; the catch is expected */ }
  // Give the new server a beat to bind, then reload the page.
  setTimeout(() => window.location.reload(), 1200);
});

// nextIsTestValue moved to utils/command-launcher.js (KJC-TSK-0501 step 8e/8).

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.project-card__is-test');
  if (!btn) return;
  e.stopPropagation();
  e.preventDefault();
  const projectId = btn.dataset.projectId;
  const next = nextIsTestValue(btn.dataset.isTest);
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/is-test`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_test: next }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Re-render the project list so the badge reflects the new value.
    await populateProjectSelect();
    render();
  } catch (err) {
    await showError(err.message, { title: 'Failed to update is_test' });
  }
});

// Delete project (cascade) — delegated handler on the dashboard grid
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.project-card__delete');
  if (!btn) return;
  e.stopPropagation();
  e.preventDefault();
  const projectId = btn.dataset.projectId;
  const projectName = btn.dataset.projectName || projectId;
  const ok = await showConfirm(
    `Delete project "${projectName}" and all its stories + sessions?\n\n`
    + `Also removes ~/.karajan/hu-stories/${projectId}/ from disk.`,
    { title: 'Delete project', okLabel: 'Delete', destructive: true }
  );
  if (!ok) return;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await populateProjectSelect();
    render();
  } catch (err) {
    await showError(err.message, { title: 'Failed to delete project' });
  }
});

// Modal close on backdrop click
document.getElementById('modal-backdrop').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// ESC to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Hash routing
window.addEventListener('hashchange', handleRoute);

// Make functions available globally for onclick handlers
window.showStoryDetail = showStoryDetail;
window.showSessionDetail = showSessionDetail;
window.closeModal = closeModal;
window.selectProject = selectProject;

// KJC-TSK-0414 PR4: arranca el polling del banner de standby al cargar la página.
startStandbyPolling();

// Initial load — sync disk data first so new batches are visible
triggerSync().then(() => {
  populateProjectSelect();
  handleRoute();
  subscribeToServerEvents();
});

// Server-push updates (subscribeToServerEvents, refreshCurrentView,
// smartRefresh, patchBoardIncremental, sseSource/sseRefreshTimer state)
// moved to utils/server-push.js (KJC-TSK-0501 step 8g/8).

// Prompt modal (activePromptId / showPromptModal / closePromptModalIfMatches) lives in utils/modals.js (KJC-TSK-0501 step 2/8).

// cssEscape moved to utils/formatters.js (KJC-TSK-0501 step 1/8).

// Auto-refresh every 60 seconds as a SAFETY NET only — the board is
// SSE-driven (push from server) so this should rarely fire. We keep
// it at low frequency to recover from missed events on hibernation /
// network blip without flickering the UI every 10s like before.
// Uses smartRefresh too so it patches the DOM instead of full rerender.
refreshInterval = setInterval(async () => {
  if (document.getElementById('modal-backdrop').classList.contains('hidden')) {
    await triggerSync();
    await populateProjectSelect();
    await smartRefresh(null);
  }
}, 60_000);

// Server-restart detector + window.forceRefresh moved to utils/api.js
// (KJC-TSK-0501 step 3/8).
