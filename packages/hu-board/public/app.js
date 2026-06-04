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
async function renderProjectPicker() {
  const app = document.getElementById('app');
  const projects = await api('/api/projects');
  // Pre-resolve human names so the rendered list matches what the
  // header / dropdown show elsewhere.
  await Promise.all(projects.map((p) => resolveProjectMeta(p.id)));

  if (projects.length === 0) {
    app.innerHTML = renderEmptyState(
      'No projects yet',
      'Run kj plan or click ⚡ in the header to generate one. The board will pick it up automatically.'
    );
    return;
  }

  // Per-project status counts come from /api/projects/:id/stories.
  // One round-trip per project; cheap on a local SQLite-backed API.
  const allStories = await Promise.all(
    projects.map((p) => api(`/api/projects/${encodeURIComponent(p.id)}/stories`).then((s) => ({ id: p.id, stories: s })))
  );
  const byProject = new Map(allStories.map((entry) => [entry.id, entry.stories]));

  function bucket(stories) {
    const c = { pending: 0, running: 0, done: 0, failed: 0 };
    for (const s of stories) {
      if (['pending', 'certified', 'needs_context', 'blocked'].includes(s.status)) c.pending += 1;
      else if (['coding', 'reviewing'].includes(s.status)) c.running += 1;
      else if (s.status === 'done') c.done += 1;
      else if (s.status === 'failed') c.failed += 1;
    }
    return c;
  }

  // Sort: most recent activity first. Falls back to alphabetic when
  // last_activity is missing (older projects synced pre-#480).
  const sorted = [...projects].sort((a, b) => {
    const la = a.last_activity || '';
    const lb = b.last_activity || '';
    if (la && lb && la !== lb) return lb.localeCompare(la);
    return (a.name || a.id).localeCompare(b.name || b.id);
  });

  app.innerHTML = `
    <div class="section-header">
      <span class="section-header__title">Story Board</span>
      <span class="section-header__count">${sorted.length} project${sorted.length === 1 ? '' : 's'}</span>
    </div>
    <p style="padding:8px 4px 16px;color:var(--text-muted);font-size:0.9rem">
      Pick a project to see its kanban. Use the project selector in the header to switch later.
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:14px">
      ${sorted.map((p) => {
        const counts = bucket(byProject.get(p.id) || []);
        const total = counts.pending + counts.running + counts.done + counts.failed;
        const name = projectNameCache[p.id] || p.name || humaniseProjectName(p.id);
        // div en lugar de <button> para poder anidar el botón de
        // delete (HTML no permite buttons anidados). role+tabindex
        // mantienen la accesibilidad equivalente.
        return `
          <div role="button" tabindex="0" class="project-picker__card" data-project-id="${esc(p.id)}"
                  style="position:relative;text-align:left;display:flex;flex-direction:column;gap:8px;padding:14px 16px;
                         background:var(--bg-secondary);border:1px solid var(--border);
                         border-radius:var(--radius-sm);cursor:pointer;color:var(--text);
                         transition:border-color 120ms">
            <button class="project-card__delete" title="Borrar proyecto (cascade)"
                    data-project-id="${esc(p.id)}" data-project-name="${esc(name)}">🗑️</button>
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding-right:32px">
              <strong style="font-size:0.95rem">${esc(name)}</strong>
              <span style="font-size:0.75rem;color:var(--text-muted)">${total} HU${total === 1 ? '' : 's'}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:0.78rem">
              ${counts.pending > 0 ? `<span title="Pending" style="padding:2px 8px;border-radius:var(--radius-sm);background:var(--bg-primary)">⏳ ${counts.pending}</span>` : ''}
              ${counts.running > 0 ? `<span title="Running" style="padding:2px 8px;border-radius:var(--radius-sm);background:rgba(234,179,8,0.18);color:#facc15">⚙ ${counts.running}</span>` : ''}
              ${counts.done > 0 ? `<span title="Done" style="padding:2px 8px;border-radius:var(--radius-sm);background:rgba(74,222,128,0.18);color:#4ade80">✓ ${counts.done}</span>` : ''}
              ${counts.failed > 0 ? `<span title="Failed" style="padding:2px 8px;border-radius:var(--radius-sm);background:rgba(248,113,113,0.18);color:#f87171">✗ ${counts.failed}</span>` : ''}
              ${total === 0 ? `<span style="color:var(--text-muted)">empty</span>` : ''}
            </div>
            <div style="font-family:var(--font-mono, monospace);font-size:0.7rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.id)}">
              ${esc(p.id)}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  app.querySelectorAll('.project-picker__card').forEach((btn) => {
    const enter = () => {
      const id = btn.dataset.projectId;
      // Use the existing route so back/forward work and the dropdown
      // syncs via handleRoute().
      window.location.hash = `board/${encodeURIComponent(id)}`;
    };
    btn.addEventListener('click', (e) => {
      // Click sobre el botón delete anidado — el handler global ya
      // hace stopPropagation + preventDefault, pero por defensa
      // ignoramos aquí cualquier click que venga de dentro de él.
      if (e.target.closest('.project-card__delete')) return;
      enter();
    });
    btn.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.project-card__delete')) {
        e.preventDefault();
        enter();
      }
    });
    // Tiny hover affordance — no CSS file edit needed.
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--color-green)'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--border)'; });
  });
}

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

async function renderPreflightPanel(projectId) {
  const panel = document.getElementById('preflight-panel');
  if (!panel) return;
  const data = await fetchPreflight(projectId);
  preflightCache = data;
  if (!data) {
    panel.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted);padding:6px 10px;">Estado del proyecto: no disponible.</div>`;
    return;
  }
  const blockerCount = data.blockers?.length || 0;
  const warningCount = data.warnings?.length || 0;
  const okCount = (data.checks || []).filter(c => c.status === 'ok').length;
  let summaryColor, summaryIcon, summaryText;
  if (blockerCount > 0) {
    summaryColor = 'var(--color-red,#ef4444)';
    summaryIcon = '✗';
    summaryText = `${blockerCount} problema(s) bloqueante(s) — la ejecución no funcionará correctamente`;
  } else if (warningCount > 0) {
    summaryColor = 'var(--color-yellow,#eab308)';
    summaryIcon = '⚠';
    summaryText = `${warningCount} aviso(s) — la ejecución funcionará pero con limitaciones`;
  } else {
    summaryColor = 'var(--color-green)';
    summaryIcon = '✓';
    summaryText = `Todo listo · ${okCount} comprobaciones OK`;
  }

  // Compact header (always visible) + collapsed details (toggleable).
  panel.innerHTML = `
    <div class="preflight-panel__header"
         style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg-primary);border:1px solid var(--border);border-left:3px solid ${summaryColor};border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem;"
         data-toggle>
      <span style="color:${summaryColor};font-weight:700;font-size:1rem;">${summaryIcon}</span>
      <span style="color:var(--text);">${esc(summaryText)}</span>
      <span style="margin-left:auto;color:var(--text-muted);font-size:0.78rem;" data-arrow>▼ ver detalles</span>
    </div>
    <div class="preflight-panel__details" style="display:none;margin-top:6px;padding:10px 12px;background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius-sm);">
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:8px;">
        ${(data.checks || []).map((c) => `
          <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 8px;background:var(--bg-secondary,var(--bg));border-radius:var(--radius-sm);"
               title="${esc(c.consequence || '')}">
            <span style="color:${preflightStatusColor(c.status)};font-weight:700;font-size:0.95rem;flex-shrink:0;">${preflightStatusIcon(c.status)}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.8rem;font-weight:600;color:var(--text);">${esc(c.label)}</div>
              <div style="font-size:0.72rem;color:var(--text-muted);word-break:break-all;">${esc(c.detail || '')}</div>
              ${c.consequence ? `<div style="font-size:0.7rem;color:${preflightStatusColor(c.status)};margin-top:2px;">${esc(c.consequence)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  // Toggle expand/collapse without rerender.
  const header = panel.querySelector('[data-toggle]');
  const details = panel.querySelector('.preflight-panel__details');
  const arrow = panel.querySelector('[data-arrow]');
  if (header && details && arrow) {
    header.addEventListener('click', () => {
      const open = details.style.display !== 'none';
      details.style.display = open ? 'none' : 'block';
      arrow.textContent = open ? '▼ ver detalles' : '▲ ocultar detalles';
    });
  }
}

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
/**
 * PR4: launch a single HU from the per-card ▶ button. Confirms with
 * the user (so an accidental click doesn't kick a run) and POSTs to
 * the new /api/hus/:huId/run endpoint, which resolves the planId
 * server-side from the SQLite row.
 *
 * Exposed on `window` because the inline onclick on the card calls it.
 */
window.runSingleHuFromCard = async function runSingleHuFromCard(huId, title) {
  const friendlyTitle = (title || huId).replace(/&#39;/g, "'");
  const ok = await showConfirm(
    `¿Lanzar solo esta HU?\n\n${friendlyTitle}\n\nKarajan ejecutará únicamente esta HU; las demás del plan no se tocarán.`,
    { title: 'Lanzar HU individual', okLabel: 'Lanzar', cancelLabel: 'Cancelar' }
  );
  if (!ok) return;
  try {
    const res = await fetch(`/api/hus/${encodeURIComponent(huId)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'No se pudo lanzar la HU' });
      return;
    }
    const body = await res.json();
    // Surface the log path so the user can tail it from the View log button
    // AND auto-open the viewer so the click produces visible feedback. Without
    // the open, the user clicks Lanzar, sees nothing change, and concludes the
    // run never started — the run IS started, the log IS being written, the
    // UI just wasn't showing it.
    //
    // The tail URL must be derived from body.logPath, not constructed from
    // huId. When `kj run --plan ... --hu <id>` is launched, runPlan writes to
    //   <runsDir>/<planId>--hu-<localHuId>.log
    // — not <runsDir>/hu-<huId>.log. The previous code guessed the wrong
    // filename and the viewer would have hit a non-existent file even if
    // it had been opened.
    if (body.logPath) {
      const logBasename = body.logPath.split('/').pop().replace(/\.log$/, '');
      const tailUrl = (offset) => `/api/runs/${encodeURIComponent(logBasename)}/log?offset=${offset || 0}`;
      lastOpenedLog = { id: `hu-${huId}`, label: `HU ${huId}`, tailUrl };
      openGenericLogPanel({ id: logBasename, label: `HU ${huId}`, tailUrl });
    }
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();
  } catch (err) {
    await showError(err.message || String(err), { title: 'Fallo al lanzar la HU' });
  }
};

/**
 * KJC-TSK-0394 step 2: devolver una HU al estado `pending` desde
 * cualquier estado no-terminal (coding/reviewing/blocked zombi) o
 * terminal (done/failed) que el usuario quiera relanzar limpio.
 *
 * No tocamos el campo `result`: si una HU acaba en done+fail y el
 * usuario hace Reset → status: pending, result: fail (badge ✗ persiste
 * como historial). El siguiente run sobreescribirá result cuando
 * termine.
 *
 * El backend ya acepta {status: 'pending'} en ALLOWED_STORY_STATUSES
 * (ver routes/api.js); plan-mutations::setHuStatus refleja el cambio
 * al fichero del plan y resincroniza la BBDD.
 */
/**
 * Cambio libre de status desde el dropdown del modal. PATCH al backend
 * con el status nuevo + confirmación (algunos targets como `done` /
 * `failed` son blast-radius alto: no se puede deshacer sin Reset).
 *
 * El propio backend valida que `newStatus` esté en ALLOWED_STORY_
 * STATUSES, así que si el dropdown trae basura el servidor rechaza con
 * 400 — no necesitamos re-validar aquí.
 */
window.changeHuStatusFromModal = async function changeHuStatusFromModal(storyId, newStatus, oldStatus) {
  // Opción "Cambiar a…" placeholder: el usuario abrió el dropdown sin
  // elegir nada. Selecciona el placeholder otra vez para no quedar en
  // un estado ambiguo.
  if (!newStatus) return;
  const select = document.getElementById('hu-status-select');
  const ok = await showConfirm(
    `Cambiar el status de esta HU de "${oldStatus}" a "${newStatus}"?\n\nEl plan file y el board se actualizan al instante. El campo result (badge ✓/✗) se conserva como historial.`,
    { title: 'Cambiar status', okLabel: 'Cambiar', cancelLabel: 'Cancelar' }
  );
  if (!ok) { if (select) select.value = ''; return; }
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'No se pudo cambiar el status' });
      if (select) select.value = '';
      return;
    }
    closeModal();
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();
  } catch (err) {
    await showError(err.message || String(err), { title: 'Fallo al cambiar el status' });
    if (select) select.value = '';
  }
};

// KJC-TSK-0406: persist coder_model + reviewer_model overrides from the
// modal. Vacío → null (re-asignación automática por triage en siguiente
// run). Cada modelo es independiente.
window.saveHuModels = async function saveHuModels(storyId) {
  const coderInput = document.getElementById('hu-coder-model');
  const reviewerInput = document.getElementById('hu-reviewer-model');
  const patch = {
    coder_model: coderInput?.value?.trim() || null,
    reviewer_model: reviewerInput?.value?.trim() || null,
  };
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'No se pudieron guardar los modelos' });
      return;
    }
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();
  } catch (err) {
    await showError(err.message || String(err), { title: 'Fallo guardando modelos' });
  }
};

// KJC-PRP-0002 PR6: persist `hu.assignee` (free-form handle of whoever owns
// this HU on a team-shared board). Empty string → null so the API knows to
// clear, not store "". The modal only renders the input when the project is
// `is_shared = 1`, so non-team boards never trigger this path.
window.saveHuAssignee = async function saveHuAssignee(storyId) {
  const input = document.getElementById('hu-assignee');
  const value = input?.value?.trim() || null;
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee: value }),
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'No se pudo guardar el asignado' });
      return;
    }
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();
  } catch (err) {
    await showError(err.message || String(err), { title: 'Fallo guardando asignado' });
  }
};

// KJC-TSK-0408: deshace los cambios de una HU restaurando el snapshot
// git tomado pre-run. ATENCIÓN: es destructivo (git reset --hard) —
// confirmamos siempre antes de invocar.
window.undoHuChanges = async function undoHuChanges(storyId) {
  const ok = await showConfirm(
    '⚠️ Esta acción es destructiva.\n\nSe descartan los cambios de ficheros que esta HU hizo durante su última ejecución y se restaura el estado pre-run. La HU vuelve a pending y podrás relanzarla con otros modelos.\n\n¿Continuar?',
    { title: 'Deshacer cambios de la HU', okLabel: 'Deshacer', cancelLabel: 'Cancelar' }
  );
  if (!ok) return;
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/undo`, { method: 'POST' });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'No se pudo deshacer la HU' });
      return;
    }
    closeModal();
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();
  } catch (err) {
    await showError(err.message || String(err), { title: 'Fallo al deshacer la HU' });
  }
};

window.resetHuToPending = async function resetHuToPending(storyId) {
  const ok = await showConfirm(
    '¿Devolver esta HU a pending?\n\nEl estado se cambia a pending y se podrá relanzar. El resultado de la última ejecución (✓/✗/~) se conserva como historial hasta que vuelvas a ejecutarla.',
    { title: 'Reset HU', okLabel: 'Reset', cancelLabel: 'Cancelar' }
  );
  if (!ok) return;
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'No se pudo resetear la HU' });
      return;
    }
    closeModal();
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();
  } catch (err) {
    await showError(err.message || String(err), { title: 'Fallo al resetear la HU' });
  }
};

// ---- PR3: outcome modal + plan rollup banner ----
//
// Surfaces the per-HU + plan-level execution outcome the orchestrator
// stamps on the plan JSON. Plain Spanish, no jargon, designed for a
// non-technical user reviewing what happened during the run.

/**
 * Open the outcome detail modal for a single HU. The chip on each
 * card calls this with the JSON-stringified outcome (escaped for the
 * inline onclick attribute) — we parse and render the breakdown.
 *
 * Exposed on `window` because it's invoked from the inline onclick
 * attribute renderOutcomeChip writes.
 */
/**
 * PR-G: rename a project from the header ✎ button. Opens a small
 * dialog with the current name pre-filled, validates length, PUTs
 * to /api/projects/:id/name, and re-renders the board so the new
 * name shows up everywhere (header, dropdown, picker).
 *
 * Exposed on `window` because the inline onclick attribute on the
 * pencil button calls it.
 */
window.renameProjectModal = function renameProjectModal(projectId, currentName) {
  const dlg = document.getElementById('app-dialog') || ensureDialog();
  const safeCurrent = String(currentName || '').replace(/&#39;/g, "'");
  dlg.innerHTML = `
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:700;display:flex;align-items:center;gap:10px;">
      <span style="font-size:1.1rem;">✎</span>
      <span>Renombrar proyecto</span>
    </div>
    <div style="padding:14px 18px;">
      <label for="rename-input" style="display:block;font-size:0.85rem;color:var(--text);margin-bottom:6px;">
        Nombre del proyecto
      </label>
      <input type="text" id="rename-input" value="${esc(safeCurrent)}" maxlength="120"
             style="width:100%;padding:8px 10px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);font-size:0.95rem;" />
      <p style="margin:8px 0 0;font-size:0.75rem;color:var(--text-muted);">
        Se actualizará el campo <code>name</code> en cada plan JSON de este proyecto y la fila en la base de datos del board.
      </p>
      <p id="rename-error" style="margin:8px 0 0;font-size:0.78rem;color:var(--color-red,#ef4444);display:none;"></p>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="rename-cancel" style="padding:8px 16px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;">Cancelar</button>
      <button id="rename-save"   style="padding:8px 16px;background:var(--color-green);border:none;color:#fff;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;">Guardar</button>
    </div>
  `;
  if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
  const input = dlg.querySelector('#rename-input');
  const errorEl = dlg.querySelector('#rename-error');
  input?.focus();
  input?.select();
  dlg.querySelector('#rename-cancel')?.addEventListener('click', () => { try { dlg.close(); } catch { /* ignore */ } }, { once: true });
  dlg.querySelector('#rename-save')?.addEventListener('click', async () => {
    const newName = input?.value?.trim() || '';
    if (!newName) { errorEl.style.display = 'block'; errorEl.textContent = 'El nombre no puede estar vacío.'; return; }
    if (newName === safeCurrent) { try { dlg.close(); } catch { /* ignore */ } return; }
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        errorEl.style.display = 'block';
        errorEl.textContent = body?.error || `HTTP ${r.status}`;
        return;
      }
      // Update the cached display name + refresh the board so the
      // header, dropdown and project picker all show the new value.
      projectNameCache[projectId] = newName;
      try { dlg.close(); } catch { /* ignore */ }
      await populateProjectSelect();
      await renderBoard();
    } catch (err) {
      errorEl.style.display = 'block';
      errorEl.textContent = err.message || String(err);
    }
  }, { once: true });
};

window.showOutcomeModal = function showOutcomeModal(escapedJson) {
  let outcome;
  try { outcome = JSON.parse(String(escapedJson).replace(/&#39;/g, "'")); }
  catch { return; }
  const dlg = document.getElementById('app-dialog') || ensureDialog();
  const status = outcome.status || 'desconocido';
  const headerColor = status === 'done' ? 'var(--color-green)'
    : status === 'failed' ? 'var(--color-red,#ef4444)'
    : 'var(--color-yellow,#eab308)';
  const headerLabel = status === 'done' ? 'HU completada'
    : status === 'failed' ? 'HU fallida'
    : status === 'blocked' ? 'HU bloqueada'
    : `HU · ${status}`;
  const durationText = outcome.duration_ms != null ? formatDuration(outcome.duration_ms) : '—';
  const blockersHtml = (outcome.blockers || []).length === 0 ? '' : `
    <div style="margin-top:10px;">
      <div style="font-weight:600;color:var(--color-red,#ef4444);font-size:0.85rem;">Problemas detectados</div>
      <ul style="margin:4px 0 0 18px;padding:0;color:var(--text);">
        ${outcome.blockers.map(b => `<li style="font-size:0.8rem;margin-top:4px;">${esc(b)}</li>`).join('')}
      </ul>
    </div>
  `;
  const commitsHtml = (outcome.commits || []).length === 0 ? '' : `
    <div style="margin-top:10px;">
      <div style="font-weight:600;color:var(--text);font-size:0.85rem;">Commits</div>
      <ul style="margin:4px 0 0 18px;padding:0;color:var(--text-muted);">
        ${outcome.commits.map(c => `<li style="font-family:var(--font-mono,monospace);font-size:0.78rem;">${esc(c)}</li>`).join('')}
      </ul>
    </div>
  `;
  dlg.innerHTML = `
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:700;display:flex;align-items:center;gap:10px;background:${headerColor};color:#000;">
      <span style="font-size:1.2rem;">📄</span>
      <span>${esc(headerLabel)}</span>
    </div>
    <div style="padding:14px 18px;max-height:65vh;overflow:auto;">
      <p style="margin:0 0 10px;color:var(--text);">${esc(outcome.summary || '(sin resumen disponible)')}</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(180px, 1fr));gap:8px;font-size:0.8rem;">
        <div><strong>Iteraciones</strong>: ${outcome.iterations ?? '—'}</div>
        <div><strong>Duración</strong>: ${durationText}</div>
        <div><strong>Rama</strong>: <span style="font-family:var(--font-mono,monospace)">${esc(outcome.branch || '—')}</span></div>
        <div><strong>Pull Request</strong>: ${outcome.pr_url ? `<a href="${esc(outcome.pr_url)}" target="_blank" rel="noopener">abrir</a>` : '—'}</div>
        <div><strong>Terminada</strong>: ${esc(outcome.finishedAt || '—')}</div>
      </div>
      ${blockersHtml}
      ${commitsHtml}
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;">
      <button id="outcome-close" style="padding:8px 16px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;">Cerrar</button>
    </div>
  `;
  if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
  dlg.querySelector('#outcome-close')?.addEventListener('click', () => { try { dlg.close(); } catch { /* ignore */ } }, { once: true });
};

/**
 * Fetch + render the plan-level rollup banner. Shows X done / Y
 * failed / Z blocked + total duration when at least one plan in the
 * project has finished. Hidden otherwise.
 */
async function renderPlanRollup(projectId) {
  const slot = document.getElementById('plan-rollup-banner');
  if (!slot) return;
  let data;
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/plans-outcome`);
    if (!r.ok) return;
    data = await r.json();
  } catch { return; }
  const finished = (data.plans || []).filter(p => p.outcome);
  if (finished.length === 0) { slot.innerHTML = ''; return; }
  // Aggregate the most recent plan first — non-tech user usually
  // cares about "what happened just now", not historical sums.
  finished.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const recent = finished[0];
  const o = recent.outcome;
  const c = o.counts || {};
  const summaryColor = o.status === 'done' ? 'var(--color-green)'
    : o.status === 'failed' ? 'var(--color-red,#ef4444)'
    : 'var(--color-yellow,#eab308)';
  const headline = o.status === 'done' ? 'Plan finalizado correctamente'
    : o.status === 'failed' ? 'Plan terminado con errores'
    : 'Plan terminado parcialmente';
  const durationText = o.duration_ms != null ? formatDuration(o.duration_ms) : '—';
  slot.innerHTML = `
    <div style="margin:8px 0;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-left:4px solid ${summaryColor};border-radius:var(--radius-sm);font-size:0.85rem;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
      <span style="color:${summaryColor};font-weight:700;">${esc(headline)}</span>
      <span style="color:var(--text-muted);">${esc(recent.name || recent.planId)}</span>
      <span style="color:var(--text);">✓ ${c.done || 0} hechas</span>
      ${c.failed ? `<span style="color:var(--color-red,#ef4444)">✗ ${c.failed} fallidas</span>` : ''}
      ${c.blocked ? `<span style="color:var(--color-yellow,#eab308)">⏸ ${c.blocked} bloqueadas</span>` : ''}
      <span style="color:var(--text-muted);">⏱ ${esc(durationText)}</span>
      ${(o.prs || []).length > 0 ? `<span style="color:var(--text-muted);">${o.prs.length} PR(s):</span> ${o.prs.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener" style="color:var(--color-green);">abrir</a>`).join(' · ')}` : ''}
    </div>
  `;
}

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

// ---- Run log viewer ----
//
// `kj run --plan` is spawned as a detached child; output lands in
// ~/.karajan/hu-board-runs/<planId>.log. The browser tails it via
// GET /api/plans/:planId/log?offset=N and appends the delta.
//
// The viewer is a NON-modal floating panel anchored to the bottom-
// right of the viewport — not a <dialog>, because:
//   - We want the user to keep clicking around the board while the
//     run is in progress (modal blocks that).
//   - <dialog>.showModal() centered the panel on top of the kanban;
//     when content overflowed (long log lines + min-width), the
//     positioning broke and the panel landed in a corner.
// Three window-style controls live in the header — minimize (collapses
// to title bar only), maximize (fills viewport), close. Polling
// keeps running while minimized so the kB counter stays live.

let logPollTimer = null;
let logViewerState = { planId: null, panel: null, offset: 0, isMax: false, isMin: false };

// ANSI_SGR + ansi256ToCss + ESC_CHARS + HTML_ESC + ansiToHtml moved to
// utils/formatters.js (KJC-TSK-0501 step 1/8).

/**
 * Open (or refocus) the run-log panel for the given plan. Thin shim
 * over `openGenericLogPanel` — the original entry point used for
 * `kj run --plan` runs that the Run-plan button kicks off.
 */
function openLogViewer(planId) {
  return openGenericLogPanel({
    id: planId,
    label: 'Run log',
    tailUrl: (offset) => `/api/plans/${encodeURIComponent(planId)}/log?offset=${offset}`,
  });
}

/**
 * Generic floating log panel anchored bottom-right. Used by:
 *   - openLogViewer(planId)         → /api/plans/:planId/log
 *   - openCommandLogViewer(cmd, id) → /api/runs/:commandId/log
 *
 * The only thing that changes between callers is the tail URL +
 * the label; the window controls (min/max/close), polling, and ANSI
 * rendering are identical.
 *
 * @param {object} args
 * @param {string} args.id        - opaque id (planId or commandId), shown in header
 * @param {string} args.label     - "Run log", "kj plan", …
 * @param {(offset:number)=>string} args.tailUrl - returns the URL to GET each tick
 */
function openGenericLogPanel({ id, label, tailUrl }) {
  // Tearing down the previous panel cleanly avoids two timers running
  // when the user opens a second log while the first is still tailing.
  if (logPollTimer) { clearTimeout(logPollTimer); logPollTimer = null; }
  if (logViewerState.panel && logViewerState.panel.parentNode) {
    logViewerState.panel.remove();
  }

  const panel = document.createElement('section');
  panel.id = 'kj-log-panel';
  panel.dataset.state = 'normal';
  panel.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:16px',
    'width:min(720px, calc(100vw - 32px))',
    'height:min(420px, calc(100vh - 80px))',
    'display:flex',
    'flex-direction:column',
    'border:1px solid var(--border)',
    'border-radius:var(--radius-sm)',
    'background:var(--bg-secondary)',
    'box-shadow:0 12px 40px rgba(0,0,0,0.45)',
    'z-index:9999',
    'overflow:hidden',
  ].join(';');

  panel.innerHTML = `
    <header style="display:flex;align-items:center;justify-content:space-between;
                   padding:8px 12px;background:var(--bg-primary);
                   border-bottom:1px solid var(--border);
                   user-select:none;flex-shrink:0">
      <div style="display:flex;align-items:baseline;gap:10px;min-width:0">
        <strong style="color:var(--text)">${esc(label)}</strong>
        <span style="font-family:var(--font-mono, monospace);font-size:0.78rem;
                     color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;
                     white-space:nowrap">${esc(id)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <span id="log-status" style="font-size:0.75rem;color:var(--text-muted);margin-right:8px">connecting…</span>
        <button id="log-min" type="button" title="Minimize (run keeps going)"
                style="${winBtnStyle('#facc15')}">_</button>
        <button id="log-max" type="button" title="Maximize / Restore"
                style="${winBtnStyle('#34d399')}">▢</button>
        <button id="log-close" type="button" title="Close panel — the run keeps going in the background. Re-open anytime via the “📜 View log” button on the board."
                style="${winBtnStyle('#f87171')}">✕</button>
      </div>
    </header>
    <pre id="log-body"
         style="margin:0;padding:12px 16px;flex:1 1 auto;overflow:auto;
                font-family:var(--font-mono, monospace);font-size:0.8rem;
                line-height:1.45;background:#0b0b0c;color:#e6e6e6;
                white-space:pre-wrap;word-break:break-word"></pre>
    <footer style="padding:6px 12px;border-top:1px solid var(--border);
                   font-size:0.7rem;color:var(--text-muted);flex-shrink:0">
      Closing this panel does NOT stop the run. It keeps going in the background;
      reopen with the 📜 View log button on the board.
    </footer>
  `;

  document.body.appendChild(panel);
  logViewerState = { planId: id, panel, offset: 0, isMax: false, isMin: false };

  const bodyEl = panel.querySelector('#log-body');
  const statusEl = panel.querySelector('#log-status');
  const footerEl = panel.querySelector('footer');
  const minBtn = panel.querySelector('#log-min');
  const maxBtn = panel.querySelector('#log-max');
  const closeBtn = panel.querySelector('#log-close');

  // ---- Window controls ----
  closeBtn.addEventListener('click', () => {
    if (logPollTimer) { clearTimeout(logPollTimer); logPollTimer = null; }
    panel.remove();
    logViewerState = { planId: null, panel: null, offset: 0, isMax: false, isMin: false };
  });

  minBtn.addEventListener('click', () => {
    logViewerState.isMin = !logViewerState.isMin;
    if (logViewerState.isMin) {
      // Collapse to header-only pill anchored at bottom-right. Polling
      // continues so the kB counter stays live; click min again to expand.
      panel.style.height = 'auto';
      panel.style.width = 'auto';
      bodyEl.style.display = 'none';
      footerEl.style.display = 'none';
      panel.dataset.state = 'min';
    } else {
      panel.style.height = logViewerState.isMax ? 'calc(100vh - 32px)' : 'min(420px, calc(100vh - 80px))';
      panel.style.width = logViewerState.isMax ? 'calc(100vw - 32px)' : 'min(720px, calc(100vw - 32px))';
      bodyEl.style.display = '';
      footerEl.style.display = '';
      panel.dataset.state = logViewerState.isMax ? 'max' : 'normal';
    }
  });

  maxBtn.addEventListener('click', () => {
    logViewerState.isMin = false;
    logViewerState.isMax = !logViewerState.isMax;
    bodyEl.style.display = '';
    footerEl.style.display = '';
    if (logViewerState.isMax) {
      panel.style.top = '16px';
      panel.style.left = '16px';
      panel.style.right = '16px';
      panel.style.bottom = '16px';
      panel.style.width = 'auto';
      panel.style.height = 'auto';
      panel.dataset.state = 'max';
    } else {
      panel.style.top = '';
      panel.style.left = '';
      panel.style.right = '16px';
      panel.style.bottom = '16px';
      panel.style.width = 'min(720px, calc(100vw - 32px))';
      panel.style.height = 'min(420px, calc(100vh - 80px))';
      panel.dataset.state = 'normal';
    }
  });

  // ---- Tail loop ----
  async function tick() {
    if (!logViewerState.panel) return;        // user closed
    try {
      const res = await fetch(tailUrl(logViewerState.offset));
      if (!res.ok) {
        statusEl.textContent = `error: HTTP ${res.status}`;
        logPollTimer = setTimeout(tick, 4000);
        return;
      }
      const body = await res.json();
      if (!body.exists) {
        statusEl.textContent = 'waiting for run to start…';
      } else {
        if (body.content) {
          // Append rendered HTML so ANSI escape codes show as colour
          // instead of literal `[1m…[0m` noise (the user's complaint).
          // Auto-scroll only when the user was already at the bottom,
          // so manual scrollback doesn't fight the tail.
          const atBottom = bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 8;
          bodyEl.insertAdjacentHTML('beforeend', ansiToHtml(body.content));
          if (atBottom) bodyEl.scrollTop = bodyEl.scrollHeight;
        }
        logViewerState.offset = body.size;
        statusEl.textContent = `${(body.size / 1024).toFixed(1)} KB — live`;
      }
    } catch (err) {
      statusEl.textContent = `error: ${err.message}`;
    }
    logPollTimer = setTimeout(tick, 2000);
  }

  tick();
}

/** Inline style for the three window-control buttons in the log panel. */
function winBtnStyle(accentColor) {
  return [
    'width:22px',
    'height:22px',
    'padding:0',
    'border:1px solid var(--border)',
    `background:${accentColor}`,
    'color:#0b0b0c',
    'font-weight:700',
    'font-size:0.78rem',
    'line-height:20px',
    'border-radius:50%',
    'cursor:pointer',
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
  ].join(';');
}

// ---- Detail Modals ----

/**
 * Shows the story detail modal.
 * @param {string} storyId
 */
async function showStoryDetail(storyId) {
  const backdrop = document.getElementById('modal-backdrop');
  const content = document.getElementById('modal-content');
  backdrop.classList.remove('hidden');

  content.innerHTML = '<div class="loading"><div class="loading__spinner"></div></div>';

  try {
    const story = await api(`/api/stories/${encodeURIComponent(storyId)}`);
    const antipatterns = story.antipatterns ? JSON.parse(story.antipatterns) : [];
    const ac = story.acceptance_criteria ? JSON.parse(story.acceptance_criteria) : [];
    const tests = story.acceptance_tests ? JSON.parse(story.acceptance_tests) : [];
    const ctxRequests = story.context_requests || [];
    const initials = await resolveProjectInitials(story.project_id);
    const shortId = shortStoryId(story, initials);

    const dimLabels = ['Independent', 'Negotiable', 'Valuable', 'Estimable', 'Small', 'Testable'];

    // Edit-in-place is gated on plan-backed stories: legacy rows
    // (plan_id null) have no source-of-truth file to write to, so PATCH
    // would 409 anyway.
    const canEdit = ['pending', 'certified', 'needs_context', 'blocked'].includes(story.status);
    // KJC-TSK-0394 step 2: "Reset to pending" para destrabar HUs zombi
    // (coding/reviewing/blocked colgados) o relanzar limpio una HU
    // done/failed. Solo plan-backed. Pending/certified ya están en el
    // estado destino, no tiene sentido el botón.
    const canResetToPending = story.plan_id
      && !['pending', 'certified'].includes(story.status);
    // Dropdown libre de status. Solo plan-backed. La lista es la misma
    // que ALLOWED_STORY_STATUSES en el backend — NO incluye coding/
    // reviewing/running (esos los pone el orquestador; setearlos a
    // mano genera zombies en el reaper).
    const canChangeStatus = !!story.plan_id;
    // KJC-TSK-0403: 'failed' eliminado del dropdown — result=fail vive en
    // la HU via outcome.blockers, no como status manual.
    const userSettableStatuses = ['pending', 'certified', 'done', 'blocked', 'needs_context'];

    content.innerHTML = `
      <div class="modal__header">
        <div>
          <div class="modal__title" title="${esc(story.id)}">${esc(shortId)}</div>
          <div class="modal__subtitle" style="font-size:0.75rem;color:var(--text-muted);font-family:monospace;margin-top:2px">${esc(story.id)}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            <span class="story-card__status status--${story.status}">${esc(story.status)}</span>
            ${canChangeStatus ? `
              <select id="hu-status-select"
                      title="Cambiar manualmente el status de esta HU"
                      style="padding:3px 6px;font-size:0.75rem;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer"
                      onchange="changeHuStatusFromModal('${esc(story.id)}', this.value, '${esc(story.status)}')">
                <option value="">Cambiar a…</option>
                ${userSettableStatuses
                  .filter((s) => s !== story.status)
                  .map((s) => `<option value="${s}">${s}</option>`)
                  .join('')}
              </select>
            ` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${canEdit ? `
            <button id="edit-hu-btn" class="control-btn"
                    style="padding:6px 12px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem"
                    title="Edit title, scope, task type, and acceptance criteria">
              ✎ Edit
            </button>
          ` : ''}
          ${canResetToPending ? `
            <button id="reset-hu-btn" class="control-btn"
                    style="padding:6px 12px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem"
                    title="Devolver esta HU a pending (sin tocar el result anterior)"
                    onclick="resetHuToPending('${esc(story.id)}')">
              ↺ Reset
            </button>
          ` : ''}
          ${(() => {
            // KJC-TSK-0408: Undo solo si la HU tiene snapshot_sha en outcome.
            let parsedOutcome = null;
            try { parsedOutcome = typeof story.outcome === 'string' ? JSON.parse(story.outcome) : story.outcome; } catch { /* */ }
            const canUndo = parsedOutcome?.snapshot_sha && !parsedOutcome?.reverted;
            return canUndo ? `
              <button id="undo-hu-btn" class="control-btn"
                      style="padding:6px 12px;border:1px solid var(--color-red,#ef4444);background:var(--bg-primary);color:var(--color-red,#ef4444);border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem"
                      title="Deshacer cambios de esta HU: restaura los ficheros al snapshot pre-run y marca pending"
                      onclick="undoHuChanges('${esc(story.id)}')">
                ⏪ Undo
              </button>
            ` : '';
          })()}
          <button class="modal__close" onclick="closeModal()">&times;</button>
        </div>
      </div>


      <div class="modal__section">
        <div class="modal__section-title">Original Text</div>
        <div class="modal__field-value">${esc(story.original_text || 'N/A')}</div>
      </div>

      ${(story.coder_model || story.reviewer_model || canEdit) ? `
        <!-- KJC-TSK-0406: model routing per HU. Cada modelo es independiente
             y editable. Reviewer cross-provider del coder por defecto. -->
        <div class="modal__section">
          <div class="modal__section-title">Models</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:0.85rem">
            <div>
              <div class="modal__field-label">Coder</div>
              <div class="modal__field-value" style="font-family:monospace">
                ${esc(story.coder_model || 'auto')} ${story.coder_provider ? `<span style="color:var(--text-muted)">(${esc(story.coder_provider)})</span>` : ''}
              </div>
              ${canEdit ? `
                <input id="hu-coder-model" type="text" placeholder="modelo override"
                       value="${esc(story.coder_model || '')}"
                       style="margin-top:4px;width:100%;padding:4px;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:4px;font-family:monospace;font-size:0.8rem">
              ` : ''}
            </div>
            <div>
              <div class="modal__field-label">Reviewer (cross-provider)</div>
              <div class="modal__field-value" style="font-family:monospace">
                ${esc(story.reviewer_model || 'auto')} ${story.reviewer_provider ? `<span style="color:var(--text-muted)">(${esc(story.reviewer_provider)})</span>` : ''}
              </div>
              ${canEdit ? `
                <input id="hu-reviewer-model" type="text" placeholder="modelo override"
                       value="${esc(story.reviewer_model || '')}"
                       style="margin-top:4px;width:100%;padding:4px;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:4px;font-family:monospace;font-size:0.8rem">
              ` : ''}
            </div>
          </div>
          ${canEdit ? `
            <div style="margin-top:8px;display:flex;gap:6px;align-items:center">
              <button onclick="saveHuModels('${esc(story.id)}')" class="control-btn"
                      style="padding:4px 10px;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:0.8rem">
                💾 Save models
              </button>
              <span style="color:var(--text-muted);font-size:0.75rem">vacío → re-asignar automáticamente</span>
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${projectIsSharedCache[story.project_id] === 1 ? `
        <!-- KJC-PRP-0002 PR6: per-HU assignee — only surfaced when the
             project is team-shared. Free-form string; no entity table. -->
        <div class="modal__section">
          <div class="modal__section-title">Asignado a</div>
          <div class="modal__field-value" style="font-family:monospace">${esc(story.assignee || '—')}</div>
          ${canEdit ? `
            <div style="margin-top:6px;display:flex;gap:6px;align-items:center">
              <input id="hu-assignee" type="text" placeholder="@manu, dev_016, becaria…"
                     value="${esc(story.assignee || '')}"
                     style="flex:1;padding:4px;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:4px;font-family:monospace;font-size:0.8rem">
              <button onclick="saveHuAssignee('${esc(story.id)}')" class="control-btn"
                      style="padding:4px 10px;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:0.8rem">
                💾 Save
              </button>
            </div>
            <div style="margin-top:4px;color:var(--text-muted);font-size:0.75rem">vacío → sin asignar</div>
          ` : ''}
        </div>
      ` : ''}

      ${story.certified_as ? `
        <div class="modal__section">
          <div class="modal__section-title">Certified Story</div>
          <div class="modal__field">
            <div class="modal__field-label">As a...</div>
            <div class="modal__field-value">${esc(story.certified_as)}</div>
          </div>
          <div class="modal__field">
            <div class="modal__field-label">I want to...</div>
            <div class="modal__field-value">${esc(story.certified_want || '--')}</div>
          </div>
          <div class="modal__field">
            <div class="modal__field-label">So that...</div>
            <div class="modal__field-value">${esc(story.certified_so_that || '--')}</div>
          </div>
        </div>
      ` : story.certified_want ? `
        <div class="modal__section">
          <div class="modal__section-title">Scope</div>
          <div class="modal__field-value" style="white-space: pre-wrap; font-size: 0.9rem; line-height: 1.5;">${esc(story.certified_want)}</div>
        </div>
      ` : ''}

      ${story.quality_total !== null ? `
        <div class="modal__section">
          <div class="modal__section-title">Quality Score: ${story.quality_total}/60</div>
          <div class="modal__quality-grid">
            ${[1, 2, 3, 4, 5, 6].map((d, i) => {
              const val = story[`quality_d${d}`];
              return `
                <div class="modal__quality-dim">
                  <div class="modal__quality-dim-label">${dimLabels[i]}</div>
                  <div class="modal__quality-dim-value">${val !== null ? val + '/10' : '--'}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${antipatterns.length > 0 ? `
        <div class="modal__section">
          <div class="modal__section-title">Antipatterns</div>
          ${antipatterns.map((a) => `<div class="story-card__antipattern" style="margin-bottom:4px">${esc(a)}</div>`).join('')}
        </div>
      ` : ''}

      ${ac.length > 0 ? `
        <div class="modal__section">
          <div class="modal__section-title">Acceptance Criteria${story.ac_format ? ` (${esc(story.ac_format)})` : ''}</div>
          <ul class="modal__ac-list">
            ${ac.map((c) => {
              if (typeof c === 'string') return `<li class="modal__ac-item">${esc(c)}</li>`;
              if (c.given) return `<li class="modal__ac-item"><code>Given</code> ${esc(c.given)}<br><code>When</code> ${esc(c.when)}<br><code>Then</code> ${esc(c.then)}</li>`;
              return `<li class="modal__ac-item">${esc(JSON.stringify(c))}</li>`;
            }).join('')}
          </ul>
        </div>
      ` : ''}

      ${tests.length === 0 ? `
        <div class="modal__section" style="border:1px solid var(--color-yellow,#eab308);background:rgba(234,179,8,0.08);padding:10px 12px;border-radius:var(--radius-sm)">
          <div class="modal__section-title" style="color:var(--color-yellow,#eab308)">⚠ Missing test contract</div>
          <div style="font-size:0.85rem;line-height:1.5;margin-top:4px">
            This HU has no acceptance_tests declared. The tests-first pipeline (v2.7.5)
            refuses to run HUs without an executable contract. Click ✎ Edit above and
            add at least one test — a <code>shell</code> command that exits 0 on pass,
            or a <code>gherkin</code> Given/When/Then spec.
          </div>
        </div>
      ` : `
        <div class="modal__section">
          <div class="modal__section-title">Acceptance Tests (${tests.length})</div>
          <ul class="modal__ac-list">
            ${tests.map((t) => {
              // Legacy form: plain string — render as shell.
              if (typeof t === 'string') {
                return `<li class="modal__ac-item"><span style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-right:8px">shell</span><code>${esc(t)}</code></li>`;
              }
              // v2.7.5 structured form: { type, content, file? }
              if (t && typeof t === 'object' && typeof t.content === 'string') {
                const type = t.type === 'gherkin' ? 'gherkin' : 'shell';
                const badgeColor = type === 'gherkin' ? 'var(--color-blue,#3b82f6)' : 'var(--text-muted)';
                const fileBit = t.file ? ` <span style="color:var(--text-muted);font-size:0.75rem;margin-left:8px">→ ${esc(t.file)}</span>` : '';
                if (type === 'gherkin') {
                  return `<li class="modal__ac-item"><span style="font-size:0.7rem;color:${badgeColor};text-transform:uppercase;letter-spacing:0.5px;margin-right:8px">gherkin</span>${fileBit}<pre style="white-space:pre-wrap;margin:4px 0 0 0;font-family:inherit;font-size:0.9rem;line-height:1.5">${esc(t.content)}</pre></li>`;
                }
                return `<li class="modal__ac-item"><span style="font-size:0.7rem;color:${badgeColor};text-transform:uppercase;letter-spacing:0.5px;margin-right:8px">shell</span>${fileBit}<code>${esc(t.content)}</code></li>`;
              }
              // Fallback for anything else: show the raw JSON so the user
              // can diagnose malformed entries.
              return `<li class="modal__ac-item"><code>${esc(JSON.stringify(t))}</code></li>`;
            }).join('')}
          </ul>
        </div>
      `}

      ${ctxRequests.length > 0 ? `
        <div class="modal__section">
          <div class="modal__section-title">Context Requests (${ctxRequests.length})</div>
          ${ctxRequests.map((cr) => `
            <div style="background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px;margin-bottom:6px;">
              <div style="font-size:0.8rem;color:var(--color-yellow);">${esc(cr.question || 'Fields needed: ' + (cr.fields_needed || ''))}</div>
              ${cr.answer ? `<div style="font-size:0.8rem;color:var(--color-green);margin-top:4px;">${esc(cr.answer)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}

      <details class="modal__section" style="margin-top:8px">
        <summary style="cursor:pointer;font-weight:600;font-size:0.85rem;color:var(--text-muted);padding:6px 0">
          Metadata
        </summary>
        <div style="padding-top:6px">
          <div class="modal__field"><span class="modal__field-label">Project:</span> ${esc(story.project_id)}</div>
          ${story.spec_section ? `<div class="modal__field"><span class="modal__field-label">Implements SPEC:</span> §${esc(story.spec_section)}</div>` : ''}
          <div class="modal__field"><span class="modal__field-label">Session:</span> ${esc(story.session_id || '--')}</div>
          <div class="modal__field"><span class="modal__field-label">Created:</span> ${esc(story.created_at || '--')}</div>
          <div class="modal__field"><span class="modal__field-label">Updated:</span> ${esc(story.updated_at || '--')}</div>
          ${story.certified_at ? `<div class="modal__field"><span class="modal__field-label">Certified at:</span> ${esc(story.certified_at)}</div>` : ''}
        </div>
      </details>
    `;

    // Wire the Edit button — stays within the modal so we don't flash
    // a re-fetch; the edit form overwrites innerHTML in place.
    const editBtn = document.getElementById('edit-hu-btn');
    if (editBtn) editBtn.addEventListener('click', () => renderStoryEditForm(story));
  } catch (err) {
    content.innerHTML = `<div class="modal__header"><div class="modal__title">Error</div><button class="modal__close" onclick="closeModal()">&times;</button></div><p>${esc(err.message)}</p>`;
  }
}

/**
 * Swap the story modal into an inline edit form. Accepts the full story
 * record that `showStoryDetail` just rendered so we don't re-fetch —
 * the user's intent is "edit what I'm looking at".
 *
 * Cancel restores the read-only view via `showStoryDetail`; Save posts a
 * PATCH and, on success, re-opens in read-only with the refreshed row.
 *
 * @param {object} story
 */
function renderStoryEditForm(story) {
  const content = document.getElementById('modal-content');
  const initials = projectInitialsCache[story.project_id] || 'kj';
  const shortId = shortStoryId(story, initials);

  const rawAc = story.acceptance_criteria ? JSON.parse(story.acceptance_criteria) : [];
  // Represent AC as text: plain strings go verbatim, Gherkin objects
  // collapse to "Given … | When … | Then …". On save we parse back —
  // if the line matches the pattern we treat it as Gherkin, otherwise
  // a free-form string.
  const acInitial = rawAc
    .map((c) => typeof c === 'string' ? c : (c.given ? `Given ${c.given} | When ${c.when} | Then ${c.then}` : JSON.stringify(c)))
    .join('\n');

  // Tests-first editor: one block per test with a type selector
  // (shell | gherkin), the content textarea, optional file path, and
  // a remove button. Save collects them into the structured v2.7.5
  // array shape. Plain strings in the existing data are treated as
  // legacy shell tests and auto-upgraded to the structured form.
  const rawTests = story.acceptance_tests ? JSON.parse(story.acceptance_tests) : [];
  const testsInitial = rawTests.map((t) => {
    if (typeof t === 'string') return { type: 'shell', content: t, file: '' };
    if (t && typeof t === 'object') {
      return {
        type: t.type === 'gherkin' ? 'gherkin' : 'shell',
        content: typeof t.content === 'string' ? t.content : JSON.stringify(t),
        file: typeof t.file === 'string' ? t.file : '',
      };
    }
    return { type: 'shell', content: String(t ?? ''), file: '' };
  });

  const scopeInitial = story.original_text || story.certified_want || '';
  const TASK_TYPES = ['sw', 'infra', 'doc', 'add-tests', 'refactor'];

  content.innerHTML = `
    <div class="modal__header">
      <div>
        <div class="modal__title" title="${esc(story.id)}">${esc(shortId)} <span style="font-size:0.75rem;color:var(--text-muted);font-weight:normal">(editing)</span></div>
        <div class="modal__subtitle" style="font-size:0.75rem;color:var(--text-muted);font-family:monospace;margin-top:2px">${esc(story.id)}</div>
      </div>
      <button class="modal__close" onclick="closeModal()">&times;</button>
    </div>

    <form id="hu-edit-form" onsubmit="return false" style="display:flex;flex-direction:column;gap:14px;padding:8px 0">
      <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem">
        <span style="color:var(--text-muted)">Title</span>
        <input type="text" id="edit-title" value="${esc(story.title || '')}"
               style="padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-size:0.95rem"
               maxlength="200" required>
      </label>

      <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem">
        <span style="color:var(--text-muted)">Scope</span>
        <textarea id="edit-scope" rows="4"
                  style="padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-family:inherit;font-size:0.9rem;line-height:1.5;resize:vertical">${esc(scopeInitial)}</textarea>
      </label>

      <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem">
        <span style="color:var(--text-muted)">Task type</span>
        <select id="edit-task-type"
                style="padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-size:0.9rem">
          ${TASK_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </label>

      <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem">
        <span style="color:var(--text-muted)">
          Acceptance criteria — one per line.
          Gherkin: <code>Given X | When Y | Then Z</code>
        </span>
        <textarea id="edit-ac" rows="6"
                  style="padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-family:var(--font-mono, monospace);font-size:0.85rem;line-height:1.5;resize:vertical">${esc(acInitial)}</textarea>
      </label>

      <fieldset style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;margin:0">
        <legend style="color:var(--text-muted);font-size:0.85rem;padding:0 6px">
          Acceptance tests — the contract the coder must satisfy
        </legend>
        <div id="edit-tests-list" style="display:flex;flex-direction:column;gap:8px"></div>
        <button type="button" id="edit-tests-add"
                style="margin-top:8px;padding:4px 10px;font-size:0.8rem;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer">
          + Add test
        </button>
      </fieldset>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;padding-top:12px;border-top:1px solid var(--border)">
        <button type="button" id="edit-cancel" class="control-btn"
                style="padding:6px 14px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer">
          Cancel
        </button>
        <button type="button" id="edit-save" class="control-btn"
                style="padding:6px 14px;border:none;background:var(--color-green);color:#fff;border-radius:var(--radius-sm);cursor:pointer;font-weight:600">
          Save
        </button>
      </div>
    </form>
  `;

  // Tests editor state + renderers. Kept on the function scope (not
  // on window) so reopening the form gives a fresh copy.
  let testRows = [...testsInitial];
  const listEl = document.getElementById('edit-tests-list');

  function renderTestsEditor() {
    listEl.innerHTML = testRows.map((t, i) => `
      <div class="edit-test-row" data-idx="${i}"
           style="display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:start;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-primary)">
        <select data-field="type"
                style="padding:4px 6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);border-radius:var(--radius-sm);font-size:0.8rem">
          <option value="shell"${t.type === 'shell' ? ' selected' : ''}>shell</option>
          <option value="gherkin"${t.type === 'gherkin' ? ' selected' : ''}>gherkin</option>
        </select>
        <div style="display:flex;flex-direction:column;gap:4px">
          <textarea data-field="content" rows="${t.type === 'gherkin' ? 3 : 2}"
                    placeholder="${t.type === 'gherkin' ? 'Given …\\nWhen …\\nThen …' : 'npx vitest run test/foo.test.js'}"
                    style="padding:6px 8px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);border-radius:var(--radius-sm);font-family:var(--font-mono, monospace);font-size:0.82rem;line-height:1.4;resize:vertical">${esc(t.content)}</textarea>
          <input type="text" data-field="file" placeholder="Optional: file path (e.g. tests/login.test.ts)" value="${esc(t.file || '')}"
                 style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);border-radius:var(--radius-sm);font-family:var(--font-mono, monospace);font-size:0.75rem">
        </div>
        <button type="button" data-field="remove" title="Remove this test"
                style="align-self:start;padding:4px 8px;background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:var(--radius-sm);cursor:pointer;font-size:0.8rem">✕</button>
      </div>
    `).join('');

    // Bind the edit events. We re-bind on every render — cheap, and
    // keeps the state → DOM mapping simple.
    listEl.querySelectorAll('.edit-test-row').forEach((row) => {
      const idx = Number(row.dataset.idx);
      row.querySelector('[data-field="type"]').addEventListener('change', (e) => {
        testRows[idx].type = e.target.value;
        renderTestsEditor();            // re-render so placeholder updates
      });
      row.querySelector('[data-field="content"]').addEventListener('input', (e) => {
        testRows[idx].content = e.target.value;
      });
      row.querySelector('[data-field="file"]').addEventListener('input', (e) => {
        testRows[idx].file = e.target.value;
      });
      row.querySelector('[data-field="remove"]').addEventListener('click', () => {
        testRows.splice(idx, 1);
        renderTestsEditor();
      });
    });
  }

  renderTestsEditor();

  document.getElementById('edit-tests-add').addEventListener('click', () => {
    testRows.push({ type: 'shell', content: '', file: '' });
    renderTestsEditor();
  });

  document.getElementById('edit-cancel').addEventListener('click', () => showStoryDetail(story.id));
  document.getElementById('edit-save').addEventListener('click', () => saveStoryEdits(story, () => testRows));
}

/**
 * Collect the form values, compute the diff against the story as it
 * was on modal open, and PATCH only the changed fields. Empty diff is
 * a no-op (close out of edit mode without an API call).
 * @param {object} story
 */
async function saveStoryEdits(story, getTestRows) {
  const title = document.getElementById('edit-title').value.trim();
  const scope = document.getElementById('edit-scope').value;
  const taskType = document.getElementById('edit-task-type').value;
  const acRaw = document.getElementById('edit-ac').value;

  if (!title) {
    await showError('Title cannot be empty.', { title: 'Invalid input' });
    return;
  }

  // Parse AC: one per line; a line with "Given X | When Y | Then Z"
  // (case-insensitive) becomes Gherkin; everything else stays a string.
  // Blank lines are dropped.
  const acceptance_criteria = acRaw.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^Given\s+(.*?)\s*\|\s*When\s+(.*?)\s*\|\s*Then\s+(.*)$/i.exec(line);
      if (m) return { given: m[1].trim(), when: m[2].trim(), then: m[3].trim() };
      return line;
    });

  // Collect the structured acceptance_tests from the editor state,
  // dropping rows the user left empty.
  const testRows = typeof getTestRows === 'function' ? getTestRows() : [];
  const acceptance_tests = testRows
    .map((t) => ({
      type: t.type === 'gherkin' ? 'gherkin' : 'shell',
      content: (t.content || '').trim(),
      file: (t.file || '').trim(),
    }))
    .filter((t) => t.content.length > 0)
    .map((t) => (t.file ? t : { type: t.type, content: t.content }));

  // Diff against the original so we don't send untouched fields and
  // let the server's COALESCE keep existing values.
  const patch = {};
  const originalScope = story.original_text || story.certified_want || '';
  if (title !== (story.title || '')) patch.title = title;
  if (scope !== originalScope) patch.scope = scope;
  if (taskType && taskType !== 'sw') patch.task_type = taskType;
  const prevAcStr = story.acceptance_criteria || '[]';
  const nextAcStr = JSON.stringify(acceptance_criteria);
  if (nextAcStr !== prevAcStr) patch.acceptance_criteria = acceptance_criteria;
  const prevTestsStr = story.acceptance_tests || '[]';
  const nextTestsStr = JSON.stringify(acceptance_tests);
  if (nextTestsStr !== prevTestsStr) patch.acceptance_tests = acceptance_tests;

  if (Object.keys(patch).length === 0) {
    showStoryDetail(story.id);
    return;
  }

  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(story.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      if (res.status === 404) {
        await showError(
          'The board server does not recognise the extended PATCH endpoint.\n\n'
          + 'Restart it to pick up v2.7.5+:\n\n'
          + '    kj board stop && kj board start',
          { title: 'Board out of date' }
        );
        return;
      }
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'Could not save HU' });
      return;
    }
    await renderBoard();               // card shows new title/counts
    await showStoryDetail(story.id);   // reopen modal with fresh data
  } catch (err) {
    await showError(err.message, { title: 'Could not save HU' });
  }
}

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

// PR5: kj.config.yml editor modal
//
// Goal: a non-technical user opens the modal, picks "Sonnet siempre"
// from a dropdown, hits "Guardar", and the next `kj run` is cheap.
// No yml editing, no terminal trip.
//
// Each EDITABLE_FIELDS entry the backend exposes becomes one form
// row. `select` → <select>, `boolean` → <input type=checkbox>,
// `number` → <input type=number min/max>. Help text under each
// label as a small grey paragraph.
async function showConfigEditor(scope = 'global') {
  // v2.30.0 PR4 — scope toggle. 'global' edita ~/.karajan/kj.config.yml
  // (afecta a todos los proyectos); 'project' edita
  // <projectDir>/.karajan/kj.config.yml (sólo el repo actual). El backend
  // resuelve <projectDir> desde KJ_PROJECT_DIR || cwd.
  let cfg;
  try {
    const r = await fetch(`/api/config?scope=${encodeURIComponent(scope)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    cfg = await r.json();
  } catch (err) {
    await showError(`No se pudo leer la configuración: ${err.message}`, { title: 'Configuración' });
    return;
  }
  const dlg = document.getElementById('app-dialog') || ensureDialog();
  const renderField = (f) => {
    const id = `cfg-field-${f.key}`;
    let input = '';
    if (f.type === 'select') {
      input = `<select id="${id}" data-key="${esc(f.key)}" style="width:100%;padding:6px 8px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);">
        ${f.options.map((o) => `<option value="${esc(o)}"${o === f.value ? ' selected' : ''}>${esc(o)}</option>`).join('')}
      </select>`;
    } else if (f.type === 'boolean') {
      input = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="${id}" data-key="${esc(f.key)}"${f.value ? ' checked' : ''} style="cursor:pointer;">
        <span style="font-size:0.85rem;color:var(--text-muted);">${f.value ? 'activado' : 'desactivado'}</span>
      </label>`;
    } else if (f.type === 'number') {
      // KJC-BUG-0069 — honour the schema's `step` (e.g. 'any' for floats like
      // rag.search.alpha=0.6). HTML5 number inputs default to step=1, which
      // marks any fractional value as stepMismatch and refuses to commit.
      input = `<input type="number" id="${id}" data-key="${esc(f.key)}" value="${esc(String(f.value))}"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}${f.step != null ? ` step="${esc(String(f.step))}"` : ''} style="width:120px;padding:6px 8px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);">`;
    }
    return `
      <div style="margin-bottom:14px;">
        <label for="${id}" style="display:block;font-weight:600;color:var(--text);font-size:0.88rem;margin-bottom:4px;">${esc(f.label)}</label>
        ${input}
        ${f.help ? `<p style="margin:4px 0 0;font-size:0.75rem;color:var(--text-muted);">${esc(f.help)}</p>` : ''}
      </div>
    `;
  };

  // v2.30.0 — agrupa los campos por `f.category`. El backend declara
  // las categorías ordenadas en `cfg.categories`; cualquier campo sin
  // categoría cae a "Otros" (defensivo, no se pierde si olvidamos
  // etiquetar uno nuevo). Mantiene el orden interno del whitelist
  // dentro de cada sección.
  const cats = Array.isArray(cfg.categories) && cfg.categories.length > 0
    ? cfg.categories
    : [{ id: 'misc', label: 'Otros', icon: '⚙', order: 999 }];
  const byCat = new Map(cats.map((c) => [c.id, []]));
  byCat.set('misc', byCat.get('misc') || []);
  for (const f of cfg.fields) {
    const id = byCat.has(f.category) ? f.category : 'misc';
    if (!byCat.has(id)) byCat.set(id, []);
    byCat.get(id).push(f);
  }
  const renderSection = (cat) => {
    const fields = byCat.get(cat.id) || [];
    if (fields.length === 0) return '';
    return `
      <section style="margin-bottom:22px;">
        <h3 style="display:flex;align-items:center;gap:8px;margin:0 0 12px;padding-bottom:6px;border-bottom:1px solid var(--border);font-size:0.95rem;font-weight:700;color:var(--text);">
          <span aria-hidden="true">${esc(cat.icon || '⚙')}</span>
          <span>${esc(cat.label)}</span>
        </h3>
        ${fields.map(renderField).join('')}
      </section>
    `;
  };
  const allCats = [...cats];
  if ((byCat.get('misc') || []).length > 0 && !allCats.some((c) => c.id === 'misc')) {
    allCats.push({ id: 'misc', label: 'Otros', icon: '⚙', order: 999 });
  }
  const sectionsHtml = allCats.map(renderSection).join('');

  // PR4 — toggle global / proyecto. Cambiarlo recarga el modal contra el
  // otro fichero. Visual: dos pills mutuamente excluyentes.
  const pill = (id, value, label, active) => `
    <button data-scope="${value}" id="${id}" type="button"
      style="padding:4px 10px;border-radius:999px;border:1px solid var(--border);
      background:${active ? 'var(--color-blue)' : 'var(--bg-primary)'};
      color:${active ? '#fff' : 'var(--text)'};font-size:0.75rem;cursor:pointer;">
      ${esc(label)}
    </button>`;
  const scopeToggle = `
    <div style="display:flex;align-items:center;gap:4px;margin-left:auto;" role="radiogroup" aria-label="Ámbito de configuración">
      ${pill('cfg-scope-global',  'global',  'Global',         scope === 'global')}
      ${pill('cfg-scope-project', 'project', 'Este proyecto',  scope === 'project')}
    </div>`;
  dlg.innerHTML = `
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:700;display:flex;align-items:center;gap:10px;">
      <span style="font-size:1.2rem;">⚙</span>
      <span>Configuración de Karajan</span>
      ${scopeToggle}
    </div>
    <div style="padding:6px 18px 0;font-family:var(--font-mono,monospace);font-size:0.7rem;color:var(--text-muted);">
      ${esc(cfg.path || '')}${cfg.exists === false ? ' · (aún no existe, se creará al guardar)' : ''}
    </div>
    <div style="padding:14px 18px;max-height:65vh;overflow:auto;">
      ${sectionsHtml}
      <p style="margin:14px 0 0;font-size:0.75rem;color:var(--text-muted);">
        Los cambios se guardan en <code>kj.config.yml</code> de forma atómica (con copia de seguridad <code>.bak</code>).
        El próximo <code>kj run</code> los aplicará — no hace falta reiniciar el board.
      </p>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="config-cancel" style="padding:8px 16px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;">Cancelar</button>
      <button id="config-save" style="padding:8px 16px;background:var(--color-green);border:none;color:#fff;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;">Guardar</button>
    </div>
  `;
  if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
  // PR4 — al cambiar de pill, recargar el modal con el otro scope.
  for (const btn of dlg.querySelectorAll('[data-scope]')) {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-scope');
      if (next === scope) return;
      try { dlg.close(); } catch { /* ignore */ }
      showConfigEditor(next);
    }, { once: true });
  }
  dlg.querySelector('#config-cancel')?.addEventListener('click', () => { try { dlg.close(); } catch { /* ignore */ } }, { once: true });
  dlg.querySelector('#config-save')?.addEventListener('click', async () => {
    // Build the patch from the form, comparing against initial values
    // so we only send what changed.
    const patch = {};
    for (const f of cfg.fields) {
      const el = dlg.querySelector(`[data-key="${f.key}"]`);
      if (!el) continue;
      let v;
      if (f.type === 'boolean') v = el.checked;
      else if (f.type === 'number') v = Number(el.value);
      else v = el.value;
      if (v !== f.value) patch[f.key] = v;
    }
    if (Object.keys(patch).length === 0) {
      try { dlg.close(); } catch { /* ignore */ }
      return;
    }
    try {
      const r = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch, scope }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        const msg = body?.details?.errors?.length
          ? body.details.errors.join('\n')
          : (body.error || `HTTP ${r.status}`);
        await showError(msg, { title: 'No se pudo guardar' });
        return;
      }
      try { dlg.close(); } catch { /* ignore */ }
    } catch (err) {
      await showError(err.message || String(err), { title: 'Error guardando configuración' });
    }
  }, { once: true });
}

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
