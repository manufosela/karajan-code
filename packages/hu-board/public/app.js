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

// ---- Preflight panel + safety modal ----
//
// Goal: when a non-technical user opens a project, they should see at
// a glance whether the environment is ready (git initialised, remote
// configured, agents installed, Node version, etc.). Each missing
// item is rendered with a plain-Spanish "consequence" so the user
// understands what's at stake.
//
// The panel doubles as the gate for ▶ Run plan / ▶ Run HU: if any
// blocker (status:fail with blocking:true) is present, we refuse to
// launch. If only warnings are present, we open a confirm modal
// listing them and require an explicit "Lanzar de todos modos".

let preflightCache = null;     // memoise per-render so the modal can re-use what the panel already fetched

async function fetchPreflight(projectId) {
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/preflight`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function preflightStatusIcon(status) {
  if (status === 'ok') return '✓';
  if (status === 'warn') return '⚠';
  if (status === 'fail') return '✗';
  return 'ℹ';
}
function preflightStatusColor(status) {
  if (status === 'ok') return 'var(--color-green)';
  if (status === 'warn') return 'var(--color-yellow,#eab308)';
  if (status === 'fail') return 'var(--color-red,#ef4444)';
  return 'var(--text-muted)';
}

// renderPreflightPanel moved to utils/preflight-view.js (KJC-TSK-0501 step 7/8).

/**
 * Pre-run safety modal. Returns true if the user wants to proceed,
 * false to cancel. Call BEFORE invoking the run endpoint.
 *
 * Behaviour:
 *   - All green → returns true immediately (no modal).
 *   - Blockers present → modal explains them in plain Spanish; only
 *     "Cancelar" button (no proceed-anyway) because blockers are
 *     known to break the run.
 *   - Only warnings → modal lists them with their consequences and
 *     offers "Cancelar" or "Lanzar de todos modos" (red button so
 *     the user notices they're accepting risk).
 */
async function confirmRunWithPreflight(projectId) {
  const data = preflightCache || await fetchPreflight(projectId);
  if (!data) return true;             // can't fetch → don't block the user
  const blockers = data.blockers || [];
  const warnings = data.warnings || [];
  if (blockers.length === 0 && warnings.length === 0) return true;

  return await new Promise((resolve) => {
    const dlg = document.getElementById('app-dialog') || ensureDialog();
    const isBlocked = blockers.length > 0;
    const headerColor = isBlocked ? 'var(--color-red,#ef4444)' : 'var(--color-yellow,#eab308)';
    const allItems = [...blockers, ...warnings];
    dlg.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:700;display:flex;align-items:center;gap:10px;background:${headerColor};color:#000;">
        <span style="font-size:1.2rem;">${isBlocked ? '✗' : '⚠'}</span>
        <span>${isBlocked ? 'No se puede lanzar — falta algo crítico' : 'Atención antes de lanzar'}</span>
      </div>
      <div style="padding:14px 18px;max-height:60vh;overflow:auto;">
        <p style="margin:0 0 10px;font-size:0.9rem;color:var(--text);">
          ${isBlocked
            ? 'Se detectaron problemas bloqueantes que impedirán que Karajan funcione correctamente:'
            : 'Se detectaron avisos. Karajan puede ejecutarse, pero con limitaciones:'}
        </p>
        <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;">
          ${allItems.map((c) => `
            <li style="padding:8px 10px;background:var(--bg-primary);border-left:3px solid ${preflightStatusColor(c.status)};border-radius:var(--radius-sm);">
              <div style="font-weight:600;color:var(--text);font-size:0.85rem;">
                ${preflightStatusIcon(c.status)} ${esc(c.label)} — <span style="color:var(--text-muted);font-weight:400;">${esc(c.detail || '')}</span>
              </div>
              ${c.consequence ? `<div style="font-size:0.8rem;color:var(--text);margin-top:4px;">${esc(c.consequence)}</div>` : ''}
            </li>
          `).join('')}
        </ul>
      </div>
      <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button id="preflight-cancel" style="padding:8px 16px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;">Cancelar</button>
        ${isBlocked ? '' : `<button id="preflight-proceed" style="padding:8px 16px;background:var(--color-red,#ef4444);border:none;color:#fff;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;">Lanzar de todos modos</button>`}
      </div>
    `;
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
    const cancel = dlg.querySelector('#preflight-cancel');
    const proceed = dlg.querySelector('#preflight-proceed');
    const close = (val) => { try { dlg.close(); } catch { /* ignore */ } resolve(val); };
    cancel?.addEventListener('click', () => close(false), { once: true });
    proceed?.addEventListener('click', () => close(true), { once: true });
    dlg.addEventListener('close', () => resolve(false), { once: true });
  });
}
// HU action handlers (runSingleHuFromCard, changeHuStatusFromModal,
// saveHuModels, saveHuAssignee, undoHuChanges, resetHuToPending) moved
// to utils/hu-actions.js (KJC-TSK-0501 step 8a/8).

// renameProjectModal + showOutcomeModal moved to utils/project-actions.js
// (KJC-TSK-0501 step 8b/8).

// renderPlanRollup moved to utils/plan-rollup-view.js (KJC-TSK-0501 step 7/8).

async function runProject(projectId) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      if (res.status === 404) {
        await showError(
          'The board server does not recognise the "run" endpoint.\n\n'
          + 'Most likely cause: the board process is running a pre-v2.7.5 build. '
          + 'Restart it with:\n\n'
          + '    kj board stop && kj board start',
          { title: 'Board out of date' }
        );
        return;
      }
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'Could not launch run' });
      return;
    }
    const body = await res.json();
    // Best-effort: a chokidar tick may still be in flight, so fetch
    // once explicitly to surface the "running" state without waiting
    // for the watcher debounce.
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();

    // Remember the first successful planId so the section header can
    // offer a "View log" button without the user having to re-launch.
    const firstOk = (body.results || []).find((r) => r.ok);
    if (firstOk && firstOk.planId) {
      lastLaunchedPlanId = firstOk.planId;
      lastOpenedLog = {
        id: firstOk.planId,
        label: 'Run log',
        tailUrl: (offset) => `/api/plans/${encodeURIComponent(firstOk.planId)}/log?offset=${offset}`,
      };
      // Open the log viewer straight away — the user's mental model is
      // "I clicked Run, I want to see what's happening", not "I clicked
      // Run, now where do I look".
      openLogViewer(firstOk.planId);
    } else {
      await showError(
        `Pipeline launched for ${body.launched}/${body.total} plan(s) but `
        + 'no planId came back, so there\'s no log to show.',
        { title: 'Run started' }
      );
    }
  } catch (err) {
    await showError(err.message, { title: 'Could not launch run' });
  }
}

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

// ---- Command launcher modal ----
//
// Opens a small form inside the existing <dialog> singleton with a
// command picker (plan / architect / clean) and the appropriate
// fields per command. Submit POSTs to /api/commands/:command, the
// server spawns a detached `kj` child, and we open the existing log
// viewer (re-uses openLogViewer's tail loop, just pointed at the
// new generic /api/runs/:commandId/log endpoint).

// showConfigEditor moved to utils/config-editor.js (KJC-TSK-0501 step 8d/8).

async function showCommandLauncher() {
  const dlg = ensureDialog();
  // Per-command field schemas — kept in the client because each
  // command has different inputs and the modal renders accordingly.
  const SCHEMAS = {
    plan: {
      label: '📋 kj plan',
      help: 'Generate an implementation plan with HUs. Paste the task text OR a file path.',
      fields: [
        { name: 'taskFile', label: 'SPEC file path (absolute)', type: 'text', placeholder: '/home/me/project/SPEC.md' },
        { name: 'task', label: 'OR paste task text directly', type: 'textarea', rows: 6 },
        { name: 'context', label: 'Extra context (optional)', type: 'text' },
        { name: 'projectDir', label: 'Project directory (optional, defaults to board\'s cwd)', type: 'text' },
        { name: 'quick', label: '--quick (skip synth + reviewer)', type: 'checkbox' },
      ],
    },
    architect: {
      label: '🏛 kj architect',
      help: 'Design an architecture and persist ADRs. Same input as kj plan.',
      fields: [
        { name: 'taskFile', label: 'SPEC file path (absolute)', type: 'text', placeholder: '/home/me/project/SPEC.md' },
        { name: 'task', label: 'OR paste task text directly', type: 'textarea', rows: 6 },
        { name: 'context', label: 'Extra context (optional)', type: 'text' },
        { name: 'projectDir', label: 'Project directory (optional)', type: 'text' },
      ],
    },
    clean: {
      label: '🧹 kj clean',
      help: 'Garbage-collect plans / sessions / batches. --nuke wipes everything including the board DB.',
      fields: [
        { name: 'dryRun', label: '--dry-run (just report)', type: 'checkbox' },
        { name: 'nuke', label: '⚠ --nuke (delete everything, including this board\'s DB)', type: 'checkbox' },
      ],
    },
  };

  let active = 'plan';
  const renderForm = () => {
    const s = SCHEMAS[active];
    const fields = s.fields.map((f) => {
      const id = `cmd-field-${f.name}`;
      if (f.type === 'textarea') {
        return `
          <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem">
            <span style="color:var(--text-muted)">${esc(f.label)}</span>
            <textarea id="${id}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}"
                      style="padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-family:inherit;font-size:0.9rem;line-height:1.45;resize:vertical"></textarea>
          </label>`;
      }
      if (f.type === 'checkbox') {
        return `
          <label style="display:flex;align-items:center;gap:8px;font-size:0.85rem">
            <input type="checkbox" id="${id}">
            <span>${esc(f.label)}</span>
          </label>`;
      }
      return `
        <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem">
          <span style="color:var(--text-muted)">${esc(f.label)}</span>
          <input type="text" id="${id}" placeholder="${esc(f.placeholder || '')}"
                 style="padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-size:0.9rem">
        </label>`;
    }).join('');

    dlg.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:10px">
        <span>⚡ Run a Karajan command</span>
        <button id="cmd-close" type="button" class="control-btn"
                style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer">
          ✕
        </button>
      </div>
      <div style="padding:12px 18px;display:flex;gap:8px;border-bottom:1px solid var(--border)">
        ${Object.entries(SCHEMAS).map(([key, s]) => `
          <button type="button" data-cmd="${key}"
                  style="padding:6px 12px;border:1px solid var(--border);
                         background:${key === active ? 'var(--color-green)' : 'var(--bg-primary)'};
                         color:${key === active ? '#fff' : 'var(--text)'};
                         border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem;font-weight:${key === active ? '600' : '400'}">
            ${esc(s.label)}
          </button>
        `).join('')}
      </div>
      <form id="cmd-form" onsubmit="return false"
            style="padding:14px 18px;display:flex;flex-direction:column;gap:12px;width:min(640px, 88vw);box-sizing:border-box">
        <div style="font-size:0.8rem;color:var(--text-muted)">${esc(SCHEMAS[active].help)}</div>
        ${fields}
        <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:8px;border-top:1px solid var(--border)">
          <button type="button" id="cmd-cancel" class="control-btn"
                  style="padding:6px 14px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer">
            Cancel
          </button>
          <button type="button" id="cmd-submit" class="control-btn"
                  style="padding:6px 14px;border:none;background:var(--color-green);color:#fff;border-radius:var(--radius-sm);cursor:pointer;font-weight:600">
            Run
          </button>
        </div>
      </form>
    `;

    dlg.querySelectorAll('[data-cmd]').forEach((btn) => {
      btn.addEventListener('click', () => { active = btn.dataset.cmd; renderForm(); });
    });
    dlg.querySelector('#cmd-close').addEventListener('click', () => dlg.close());
    dlg.querySelector('#cmd-cancel').addEventListener('click', () => dlg.close());
    dlg.querySelector('#cmd-submit').addEventListener('click', () => submitCommand(active));
  };

  async function submitCommand(command) {
    const s = SCHEMAS[command];
    const body = {};
    for (const f of s.fields) {
      const el = document.getElementById(`cmd-field-${f.name}`);
      if (!el) continue;
      if (f.type === 'checkbox') body[f.name] = el.checked;
      else {
        const v = (el.value || '').trim();
        if (v) body[f.name] = v;
      }
    }
    // plan / architect: at least one of taskFile or task is required.
    if ((command === 'plan' || command === 'architect') && !body.taskFile && !body.task) {
      await showError('Provide either a SPEC file path or paste the task text.', { title: 'Missing input' });
      return;
    }
    if (command === 'clean' && body.nuke) {
      const ok = await showConfirm(
        '`kj clean --nuke` will delete EVERY plan / session / batch + wipe the HU Board DB. Cannot be undone.',
        { title: 'Confirm --nuke', okLabel: 'Wipe everything', destructive: true }
      );
      if (!ok) return;
    }

    let res, payload;
    try {
      res = await fetch(`/api/commands/${encodeURIComponent(command)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      payload = await res.json().catch(() => ({}));
    } catch (err) {
      await showError(err.message, { title: 'Could not launch command' });
      return;
    }
    if (!res.ok) {
      await showError(payload.error || `HTTP ${res.status}`, { title: 'Command rejected' });
      return;
    }

    dlg.close();
    if (payload.commandId) openCommandLogViewer(command, payload.commandId);
  }

  renderForm();
  dlg.showModal();
}

/**
 * Open the run-log panel pointed at a /api/runs/<commandId>/log
 * tail. Reuses the same panel UI as openLogViewer() for plans —
 * just swaps the URL it polls.
 */
function openCommandLogViewer(commandLabel, commandId) {
  const args = {
    id: commandId,
    label: `kj ${commandLabel}`,
    tailUrl: (offset) => `/api/runs/${encodeURIComponent(commandId)}/log?offset=${offset}`,
  };
  // Remember it so the section header's 📜 View log button can
  // re-open this same log after the user closes the panel.
  lastOpenedLog = args;
  openGenericLogPanel(args);
}

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

// is_test toggle (KJC-TSK-0371 — board polish #3). Three-state cycle:
//   null (heuristic) → 1 (always test) → 0 (always keep) → null …
// `null` is encoded as the empty string in `data-is-test` so the
// button's HTML serialisation is stable across renders.
function nextIsTestValue(current) {
  // Treat both empty string ("") and "null" as "no override" — the
  // dataset value is the empty string at render time, but URLs and
  // some legacy callers may send the literal "null".
  if (current === '' || current === 'null') return 1;
  if (current === '1') return 0;
  return null;  // from "0" → revert to default
}

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

// ---- Server-push updates ----
//
// The board gets a one-way stream of events from the server via
// Server-Sent Events; each event hints at what changed (plan file,
// session, batch). On receipt we refresh the current view in a way
// that preserves scroll position and any open modal. Full-page
// re-render is no longer on the table — clicking around doesn't
// reset your scroll anymore.
//
// EventSource auto-reconnects on drop, so we don't manage lifecycle
// ourselves. The status line below the header flashes briefly on
// each update so the user can see the data is live.

let sseSource = null;
let sseRefreshTimer = null;

function subscribeToServerEvents() {
  if (typeof EventSource === 'undefined') return;   // ancient browser
  if (sseSource) sseSource.close();
  sseSource = new EventSource('/api/events');
  sseSource.addEventListener('message', (e) => {
    // Try to parse the event as a typed payload. Prompt events drive
    // the prompt modal; everything else just nudges a re-render.
    let payload;
    try { payload = JSON.parse(e.data); } catch { payload = null; }

    if (payload?.type === 'prompt' && payload.promptId) {
      // A non-interactive runner is asking for input — pop the modal
      // immediately. fetch the full prompt body from the API so we
      // don't depend on the SSE event carrying every field.
      fetch(`/api/prompts`).then(r => r.ok ? r.json() : []).then((list) => {
        const match = list.find((p) => p.promptId === payload.promptId);
        if (match) showPromptModal(match);
      }).catch(() => {});
      return;
    }
    if (payload?.type === 'prompt-resolved' && payload.promptId) {
      // Runner read its answer file — close the modal if it's still open.
      closePromptModalIfMatches(payload.promptId);
      return;
    }

    // Default: data changed somewhere. Try the targeted DOM patch
    // first (no parpadeo, preserves scroll + hover state) and only
    // fall back to a full re-render when the patch can't apply
    // (different view, missing markers, etc.). This is the fix for
    // the "todo el board parpadea cada vez que algo cambia" UX bug.
    if (sseRefreshTimer) clearTimeout(sseRefreshTimer);
    sseRefreshTimer = setTimeout(() => smartRefresh(payload), 150);
  });
  sseSource.addEventListener('error', () => {
    // EventSource handles reconnection. Nothing to do; browsers retry
    // the `retry:` value we sent on open.
  });

  // On boot, also fetch any prompts that were already pending before
  // this tab connected (we missed their SSE add-event).
  fetch('/api/prompts').then((r) => r.ok ? r.json() : []).then((list) => {
    for (const p of list) showPromptModal(p);
  }).catch(() => {});
}

// Prompt modal (activePromptId / showPromptModal / closePromptModalIfMatches) lives in utils/modals.js (KJC-TSK-0501 step 2/8).

/**
 * Refresh the current SPA view without touching scroll position or
 * any modal state. The heavy lifting already lives in renderBoard /
 * renderGraph / renderSessions; this just re-calls them while the
 * scroll offset is pinned, so the visual effect is "the card
 * status updated in place".
 * @param {string} _rawEvent unused for now — we could branch on
 *   event type later to patch only the touched card, but a full
 *   re-render with scroll preservation is already invisible to
 *   the user and a lot simpler to reason about.
 */
async function refreshCurrentView(_rawEvent) {
  const app = document.getElementById('app');
  const scrollTop = app?.scrollTop ?? 0;
  const scrollLeft = app?.scrollLeft ?? 0;
  // Modal is in a separate DOM branch (#modal-backdrop) so render()
  // never touches it — we don't need to save its state.
  try {
    await render();
  } finally {
    const fresh = document.getElementById('app');
    if (fresh) {
      fresh.scrollTop = scrollTop;
      fresh.scrollLeft = scrollLeft;
    }
  }
}

/**
 * Smart refresh: pick the cheapest possible DOM update for the
 * incoming SSE event. Today the server sends coarse-grained events
 * (`{type: 'plan'|'batch'|'session'|'prompt'|...}`), so we route by
 * type:
 *
 *   plan / batch on the board view  → patchBoardIncremental()
 *   anything else                    → refreshCurrentView() (full re-render)
 *
 * The patch path preserves DOM nodes (no innerHTML rewrite, no
 * scroll reset, no hover/focus loss) — this is what kills the
 * "parpadeo" the user reported.
 *
 * @param {object|null} payload The parsed SSE payload, or null when
 *   the event wasn't valid JSON. Coarse types still work (we just
 *   degrade to a full re-render).
 */
async function smartRefresh(payload) {
  const onBoard = currentView === 'board' && Boolean(selectedProject);
  const isStoryRelated = payload && ['plan', 'batch'].includes(payload.type);
  if (onBoard && isStoryRelated) {
    const ok = await patchBoardIncremental();
    if (ok) return;
  }
  await refreshCurrentView();
}

/**
 * Targeted DOM patch for the Kanban board. Re-fetches the project's
 * stories, diffs them against the cards already rendered, and only
 * touches the affected nodes:
 *
 *   - status changed → move the card to the new column with a
 *     subtle animation (no DOM recreation, listeners survive)
 *   - new story      → render + insert into the right column
 *   - story removed  → fade + remove
 *   - column counts and the running badge are updated in place
 *
 * Returns false if the board's DOM markers aren't present (different
 * view, error state, etc.) so smartRefresh can fall back to a full
 * re-render.
 *
 * @returns {Promise<boolean>}
 */
async function patchBoardIncremental() {
  const kanban = document.querySelector('.kanban');
  if (!kanban) return false;          // not on the board view
  const columns = {};
  for (const col of kanban.querySelectorAll('.kanban__column')) {
    const cls = col.dataset.column;
    if (cls) columns[cls] = col;
  }
  if (!columns.pending || !columns.running) return false;

  let stories;
  try {
    stories = await api(`/api/projects/${encodeURIComponent(selectedProject)}/stories`);
  } catch { return false; }

  // Re-derive the column → status mapping (kept in lockstep with
  // renderBoard's `columns` object — change there, change here).
  const statusToColumn = (status) => {
    if (['pending', 'certified', 'needs_context', 'blocked'].includes(status)) return 'pending';
    if (['coding', 'reviewing'].includes(status)) return 'running';
    if (status === 'done') return 'done';
    if (status === 'failed') return 'failed';
    return 'pending';                  // safe default
  };

  const seen = new Set();
  for (const story of stories) {
    seen.add(story.id);
    const targetCol = columns[statusToColumn(story.status)];
    if (!targetCol) continue;
    const existing = kanban.querySelector(`.story-card[data-story-id="${cssEscape(story.id)}"]`);
    if (!existing) {
      // New story — append to its column.
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderStoryCard(story).trim();
      const node = wrapper.firstElementChild;
      if (node) {
        node.style.opacity = '0';
        targetCol.appendChild(node);
        requestAnimationFrame(() => { node.style.transition = 'opacity 200ms'; node.style.opacity = '1'; });
      }
      continue;
    }
    const previousStatus = existing.dataset.status;
    if (previousStatus !== story.status) {
      // Status changed — move the node + replace its inner content
      // (counters, time-ago, status pill) without recreating the
      // outer node so click handlers + transitions survive.
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderStoryCard(story).trim();
      const fresh = wrapper.firstElementChild;
      if (fresh) {
        existing.innerHTML = fresh.innerHTML;
        existing.dataset.status = story.status;
        existing.setAttribute('onclick', fresh.getAttribute('onclick') || '');
        if (existing.parentElement !== targetCol) {
          existing.style.transition = 'opacity 150ms';
          existing.style.opacity = '0.3';
          setTimeout(() => {
            targetCol.appendChild(existing);
            requestAnimationFrame(() => { existing.style.opacity = '1'; });
          }, 150);
        }
      }
    } else {
      // Same status — just refresh the inner block (counters / time
      // ago / antipatterns may have changed) without moving.
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderStoryCard(story).trim();
      const fresh = wrapper.firstElementChild;
      if (fresh && fresh.innerHTML !== existing.innerHTML) {
        existing.innerHTML = fresh.innerHTML;
      }
    }
  }
  // Cards that no longer exist on the server → remove with a fade.
  for (const node of kanban.querySelectorAll('.story-card')) {
    if (!seen.has(node.dataset.storyId)) {
      node.style.transition = 'opacity 150ms';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 160);
    }
  }
  // Recount each column + update the "N running" badge in the header.
  for (const [cls, col] of Object.entries(columns)) {
    const counter = col.querySelector('[data-column-count]');
    if (counter) counter.textContent = String(col.querySelectorAll('.story-card').length);
    col.style.opacity = col.querySelectorAll('.story-card').length === 0 ? '0.55' : '1';
  }
  const runningCount = columns.running.querySelectorAll('.story-card').length;
  const runningBadge = document.querySelector('.section-header__badge');
  if (runningBadge) {
    if (runningCount > 0) {
      runningBadge.textContent = `⚙ ${runningCount} running…`;
      runningBadge.style.display = '';
    } else {
      runningBadge.style.display = 'none';
    }
  }
  return true;
}

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
