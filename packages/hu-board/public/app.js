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

// ---- API Layer ----

/**
 * Fetches JSON from the API.
 * @param {string} path - API path (e.g., '/api/dashboard')
 * @returns {Promise<any>}
 */
async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Trigger a full re-scan of disk data (hu-stories + sessions).
 * Called on page load and via the sync button.
 */
async function triggerSync() {
  try {
    await fetch('/api/sync', { method: 'POST' });
  } catch { /* ignore — board may not support sync yet */ }
}

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

/**
 * Humanise a slug-ish project id so the board can show
 * "Linux Assistant Orchestrator" instead of
 * "home_manu_ws_ai_linux-assistant-orchestrator" in the header.
 *
 * Strategy: take the last slash/underscore-separated segment (that's the
 * project folder name), split it on dashes, drop short fragments and
 * title-case the rest.
 */
function humaniseProjectName(id) {
  if (!id || typeof id !== 'string') return id || '';
  const tail = id.split(/[/_]/).filter(Boolean).pop() || id;
  const words = tail
    .split(/[\s\-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0);
  if (words.length === 0) return id;
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

/**
 * Derive initials from a project name. Splits on non-word characters,
 * drops single-letter fragments ("a", "x") to avoid gibberish, keeps
 * short-but-meaningful ones ("ai", "ui"), lowercases, caps to 5 chars.
 *
 * Examples:
 *   "Linux Assistant Orchestrator"    → "lao"
 *   "AI Linux Assistant Orchestrator" → "alao"
 *   "karajan-code"                    → "kc"
 */
function deriveInitialsFromName(name) {
  const words = String(name || '')
    .split(/[\s\-_/]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 1);
  return words.map((w) => w[0].toLowerCase()).join('').slice(0, 5) || 'kj';
}

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
    return { initials, name: rawName };
  } catch {
    const fallbackName = humaniseProjectName(projectId);
    projectInitialsCache[projectId] = deriveInitialsFromName(fallbackName);
    projectNameCache[projectId] = fallbackName;
    return { initials: projectInitialsCache[projectId], name: fallbackName };
  }
}

/** Back-compat helper kept so existing callers don't break. */
async function resolveProjectInitials(projectId) {
  const meta = await resolveProjectMeta(projectId);
  return meta.initials;
}

/**
 * Build the human-facing short ID for a story card.
 * Example: `lao-003` for `home_…::hu_plan-20260424182640-4icc_003`.
 * @param {object} story
 * @param {string} initials
 * @returns {string}
 */
function shortStoryId(story, initials) {
  const id = story?.id || '';
  // Match `_<digits>` at the tail of the ID (with or without a trailing
  // namespace part). This covers `…_003` as well as `…_0012`.
  const m = /_(\d+)(?!.*\d)/.exec(id);
  const num = m ? m[1] : '?';
  return `${initials || 'kj'}-${num}`;
}

// ---- Utility Functions ----

/**
 * Returns relative time string (e.g., "2 min ago").
 * @param {string} dateStr - ISO date string
 * @returns {string}
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Formats milliseconds to human readable duration.
 * @param {number | null} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (!ms) return '--';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec.toString().padStart(2, '0')}s`;
}

/**
 * Returns a quality score CSS class based on value.
 * @param {number | null} score
 * @param {number} max
 * @returns {string}
 */
function scoreClass(score, max = 60) {
  if (score === null || score === undefined) return '';
  const pct = score / max;
  if (pct >= 0.7) return 'story-card__score--good';
  if (pct >= 0.4) return 'story-card__score--ok';
  return 'story-card__score--bad';
}

/**
 * Generates quality bar HTML segments.
 * @param {number | null} score
 * @param {number} max
 * @returns {string}
 */
function qualityBar(score, max = 60) {
  if (score === null || score === undefined) return '';
  const filled = Math.round((score / max) * 10);
  let html = '<span class="quality-bar">';
  for (let i = 0; i < 10; i++) {
    html += `<span class="quality-bar__segment${i < filled ? ' quality-bar__segment--filled' : ''}"></span>`;
  }
  html += '</span>';
  return html;
}

/**
 * Escapes HTML entities.
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

/**
 * Truncates text to a max length.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max = 100) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

// ---- Render Functions ----

/**
 * Renders the dashboard view with global stats and project cards.
 */
async function renderDashboard() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="loading__spinner"></div><p>Loading dashboard...</p></div>';

  try {
    const [stats, projects] = await Promise.all([
      api('/api/dashboard'),
      api('/api/projects'),
    ]);

    const certPct = stats.total_stories > 0
      ? Math.round((stats.certified_stories / stats.total_stories) * 100)
      : 0;

    app.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-card__value">${stats.total_stories}</div>
          <div class="stat-card__label">Total Stories</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value stat-card__value--green">${stats.certified_stories} (${certPct}%)</div>
          <div class="stat-card__label">Certified</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value stat-card__value--yellow">${stats.pending_stories}</div>
          <div class="stat-card__label">Pending</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value stat-card__value--purple">${stats.avg_quality !== null ? stats.avg_quality + '/60' : '--'}</div>
          <div class="stat-card__label">Avg Quality</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value">${stats.total_sessions}</div>
          <div class="stat-card__label">Sessions</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value stat-card__value--green">${stats.approved_sessions}</div>
          <div class="stat-card__label">Approved</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value stat-card__value--purple">${stats.total_projects}</div>
          <div class="stat-card__label">Projects</div>
        </div>
      </div>

      <div class="section-header">
        <span class="section-header__title">Projects</span>
        <span class="section-header__count">${projects.length} projects</span>
      </div>

      ${projects.length === 0 ? renderEmptyState() : `
        <div class="projects-grid">
          ${projects.map((p) => `
            <div class="project-card">
              <button class="project-card__delete" title="Delete project (cascade)" data-project-id="${esc(p.id)}" data-project-name="${esc(p.name || p.id)}">🗑️</button>
              <div class="project-card__body" onclick="selectProject('${esc(p.id)}')">
                <div class="project-card__name">${esc(p.name || p.id)}</div>
                <div class="project-card__stats">
                  <div class="project-card__stat">
                    <div class="project-card__stat-value">${p.story_count || 0}</div>
                    <div class="project-card__stat-label">Stories</div>
                  </div>
                  <div class="project-card__stat">
                    <div class="project-card__stat-value">${p.certified_count || 0}</div>
                    <div class="project-card__stat-label">Certified</div>
                  </div>
                  <div class="project-card__stat">
                    <div class="project-card__stat-value">${p.session_count || 0}</div>
                    <div class="project-card__stat-label">Sessions</div>
                  </div>
                </div>
                <div class="project-card__activity">Last activity: ${timeAgo(p.last_activity)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><div class="empty-state__title">Error loading dashboard</div><div class="empty-state__text">${esc(err.message)}</div></div>`;
  }
}

/**
 * Renders the kanban board view.
 */
async function renderBoard() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="loading__spinner"></div><p>Loading board...</p></div>';

  try {
    let stories;
    if (selectedProject) {
      stories = await api(`/api/projects/${encodeURIComponent(selectedProject)}/stories`);
    } else {
      // Get all stories from all projects
      const projects = await api('/api/projects');
      const allStories = await Promise.all(
        projects.map((p) => api(`/api/projects/${encodeURIComponent(p.id)}/stories`))
      );
      stories = allStories.flat();
    }

    // Pre-resolve project initials + name for every distinct project_id in
    // the fetched stories so `renderStoryCard` is synchronous and the header
    // can show the human-friendly project name (e.g. "Linux Assistant
    // Orchestrator" instead of the raw slug). Cached globally → at most one
    // API round-trip per project over the session.
    const uniqueProjectIds = [...new Set(stories.map((s) => s.project_id))];
    await Promise.all(uniqueProjectIds.map(resolveProjectMeta));
    if (selectedProject && !projectNameCache[selectedProject]) {
      await resolveProjectMeta(selectedProject);
    }
    const projectDisplayName = selectedProject
      ? (projectNameCache[selectedProject] || humaniseProjectName(selectedProject))
      : '';

    // Kanban status → column mapping. The plan schema recognises seven
    // statuses (pending/certified/coding/reviewing/done/failed/blocked/
    // needs_context) but the user only cares about four lanes:
    //   - Pending: anything generated but not running yet (including the
    //     legacy intermediate "certified" state, which is a no-op from
    //     the user's perspective — "I said it's ok to run but kj hasn't
    //     started yet").
    //   - Running: actively being processed by the pipeline.
    //   - Done:    pipeline approved.
    //   - Failed:  pipeline rejected.
    // Empty lanes are hidden so the board doesn't fill with sad empty
    // columns when a run is purely green.
    const columns = {
      pending: stories.filter((s) =>
        ['pending', 'certified', 'needs_context', 'blocked'].includes(s.status)
      ),
      running: stories.filter((s) => ['coding', 'reviewing'].includes(s.status)),
      done: stories.filter((s) => s.status === 'done'),
      failed: stories.filter((s) => s.status === 'failed'),
    };

    if (stories.length === 0) {
      app.innerHTML = renderEmptyState();
      return;
    }

    // "Run plan" bulk action: visible when a project is selected AND at
    // least one HU is still awaiting execution AND nothing's currently
    // running (to avoid accidentally launching a second pipeline over a
    // live one). Replaces the old "Mark as certified" button — the
    // intermediate "certified" state was noise from the user's POV.
    const awaitingCount = columns.pending.length;
    const runningCount = columns.running.length;
    const canRun = Boolean(selectedProject) && awaitingCount > 0 && runningCount === 0;
    const isRunning = runningCount > 0;

    // Always show the four canonical lanes so the user has a mental
    // map of the flow, even when every HU is still in Pending. Empty
    // columns render their header (with count=0) but suppress the "No
    // stories" placeholder inside so they don't steal visual space.
    const visibleColumns = [
      { title: 'Pending', cls: 'pending', rows: columns.pending },
      { title: 'Running', cls: 'running', rows: columns.running },
      { title: 'Done', cls: 'done', rows: columns.done },
      { title: 'Failed', cls: 'failed', rows: columns.failed },
    ];

    app.innerHTML = `
      <div class="section-header">
        <span class="section-header__title" title="${selectedProject ? esc(selectedProject) : ''}">Story Board${selectedProject ? ` - ${esc(projectDisplayName)}` : ''}</span>
        <span class="section-header__count">${stories.length} stories</span>
        ${isRunning ? `
          <span class="section-header__badge"
                style="margin-left:auto;padding:4px 10px;font-size:0.8rem;background:var(--color-yellow,#eab308);color:#000;border-radius:var(--radius-sm);font-weight:600;">
            ⚙ ${runningCount} running…
          </span>
        ` : ''}
        ${lastLaunchedPlanId ? `
          <button class="control-btn" id="view-log-btn"
                  style="${isRunning ? '' : 'margin-left:auto;'}padding:6px 12px;font-size:0.85rem;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;"
                  title="Tail the detached kj run log in a dialog">
            📜 View log
          </button>
        ` : ''}
        ${canRun ? `
          <button class="control-btn" id="run-plan-btn"
                  style="margin-left:auto;padding:6px 14px;font-size:0.9rem;background:var(--color-green);color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;"
                  title="Launch kj run --plan over every plan in this project">
            ▶ Run plan (${awaitingCount} HU${awaitingCount === 1 ? '' : 's'})
          </button>
        ` : ''}
      </div>
      <div class="kanban">
        ${visibleColumns.map((c) => renderKanbanColumn(c.title, c.cls, c.rows)).join('')}
      </div>
    `;

    if (canRun) {
      document.getElementById('run-plan-btn').addEventListener('click', async () => {
        await runProject(selectedProject);
      });
    }
    const viewLogBtn = document.getElementById('view-log-btn');
    if (viewLogBtn && lastLaunchedPlanId) {
      viewLogBtn.addEventListener('click', () => openLogViewer(lastLaunchedPlanId));
    }
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><div class="empty-state__title">Error loading board</div><div class="empty-state__text">${esc(err.message)}</div></div>`;
  }
}

// ---- DAG view ----
//
// The kanban answers "what's the status of each HU"; the graph answers
// "what depends on what, and what could run in parallel". It's a
// leveled topological layout drawn as vanilla SVG — no Cytoscape /
// D3 / Mermaid dependency because the board ships as a local
// dashboard and every KB of JS saved is one less thing that can
// mis-fetch behind a corporate proxy. The layout is basic but honest:
// roots at the top, children below, siblings side-by-side, curved
// bezier arrows. Good enough for plans up to ~30 HUs — beyond that
// we'd want a real DAG library, but that's a problem for another day.

const DAG_NODE_W = 170;
const DAG_NODE_H = 62;
const DAG_H_GAP = 28;
const DAG_V_GAP = 72;
const DAG_PAD = 32;

/**
 * Resolve `hu.blocked_by` HU-ids (e.g. "plan-xxx_001") to full story
 * ids ("<project>::plan-xxx_001") so we can join by the board's row id.
 * Ids that don't resolve are dropped silently — they usually signal a
 * cross-plan dep which we don't render.
 */
function resolveBlockedBy(rawIds, storyIds) {
  if (!Array.isArray(rawIds) || rawIds.length === 0) return [];
  const resolved = [];
  for (const raw of rawIds) {
    const match = storyIds.find((id) => id.endsWith(`::${raw}`)) || (storyIds.includes(raw) ? raw : null);
    if (match) resolved.push(match);
  }
  return resolved;
}

/**
 * Assign each story a level = 1 + max(level of its deps). Roots get 0.
 * Cycle-guarded with a visited set — KJ's planner shouldn't emit one
 * but a hand-edited plan JSON might.
 */
function computeDagLevels(stories) {
  const storyIds = stories.map((s) => s.id);
  const byId = new Map();
  for (const s of stories) {
    const rawBlockedBy = s.blocked_by ? JSON.parse(s.blocked_by) : [];
    byId.set(s.id, {
      ...s,
      resolvedBlockedBy: resolveBlockedBy(rawBlockedBy, storyIds),
    });
  }

  const levels = new Map();
  const visiting = new Set();
  function levelOf(id) {
    if (levels.has(id)) return levels.get(id);
    if (visiting.has(id)) return 0;                // cycle → break
    const s = byId.get(id);
    if (!s || s.resolvedBlockedBy.length === 0) { levels.set(id, 0); return 0; }
    visiting.add(id);
    const l = 1 + Math.max(...s.resolvedBlockedBy.map(levelOf));
    visiting.delete(id);
    levels.set(id, l);
    return l;
  }
  for (const id of byId.keys()) levelOf(id);

  const byLevel = new Map();
  for (const [id, lvl] of levels) {
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl).push(id);
  }

  return { byId, levels, byLevel };
}

/**
 * Render the graph view. If no project is selected we show a prompt
 * — drawing every project's HUs in one DAG is visual garbage. If the
 * current project has no stories or no blocked_by edges, we show a
 * friendly empty state explaining what the view is for.
 */
async function renderGraph() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="loading__spinner"></div><p>Loading graph…</p></div>';

  if (!selectedProject) {
    app.innerHTML = renderEmptyState(
      'Pick a project first',
      'The dependency graph is per-project. Choose one in the dropdown above and I will draw its HU DAG.'
    );
    return;
  }

  try {
    const stories = await api(`/api/projects/${encodeURIComponent(selectedProject)}/stories`);
    if (stories.length === 0) {
      app.innerHTML = renderEmptyState('No HUs in this project', 'Run kj plan to generate some.');
      return;
    }
    // Preload initials so node labels can use short ids synchronously.
    await resolveProjectMeta(selectedProject);
    const projectDisplayName = projectNameCache[selectedProject] || humaniseProjectName(selectedProject);
    const initials = projectInitialsCache[selectedProject] || 'kj';

    const { byId, byLevel } = computeDagLevels(stories);
    const maxLevel = Math.max(0, ...Array.from(byLevel.keys()));
    const widestLevel = Math.max(0, ...Array.from(byLevel.values()).map((ids) => ids.length));
    const width = widestLevel * (DAG_NODE_W + DAG_H_GAP) + DAG_PAD * 2;
    const height = (maxLevel + 1) * (DAG_NODE_H + DAG_V_GAP) + DAG_PAD * 2;

    // Assign x,y to each node. Within a level we distribute horizontally
    // evenly; we make no effort to minimise edge crossings (the naive
    // layout is fine for ~20 HUs, which is the realistic ceiling for a
    // single plan).
    const positions = new Map();
    for (const [lvl, ids] of byLevel) {
      const y = DAG_PAD + lvl * (DAG_NODE_H + DAG_V_GAP);
      const rowW = ids.length * DAG_NODE_W + (ids.length - 1) * DAG_H_GAP;
      const xStart = (width - rowW) / 2;
      ids.forEach((id, i) => {
        positions.set(id, { x: xStart + i * (DAG_NODE_W + DAG_H_GAP), y });
      });
    }

    const edges = [];
    for (const s of byId.values()) {
      for (const parentId of s.resolvedBlockedBy) {
        if (positions.has(parentId) && positions.has(s.id)) {
          edges.push({ from: parentId, to: s.id });
        }
      }
    }

    const anyEdges = edges.length > 0;

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
           xmlns="http://www.w3.org/2000/svg"
           style="display:block;margin:0 auto;max-width:100%;overflow:visible">
        <defs>
          <marker id="dag-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L7,4 L0,8 Z" fill="var(--text-muted)"/>
          </marker>
        </defs>
        ${edges.map((e) => {
          const p1 = positions.get(e.from);
          const p2 = positions.get(e.to);
          const x1 = p1.x + DAG_NODE_W / 2;
          const y1 = p1.y + DAG_NODE_H;
          const x2 = p2.x + DAG_NODE_W / 2;
          const y2 = p2.y;
          const cy = (y1 + y2) / 2;
          return `<path d="M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}"
                        stroke="var(--text-muted)" stroke-width="1.5" fill="none"
                        marker-end="url(#dag-arrow)" opacity="0.7"/>`;
        }).join('')}
        ${Array.from(byId.values()).map((s) => {
          const p = positions.get(s.id);
          const shortId = shortStoryId(s, initials);
          const title = truncate(s.title || s.original_text || '', 26);
          return `
            <g transform="translate(${p.x},${p.y})"
               class="dag-node status--${s.status}"
               style="cursor:pointer"
               onclick="showStoryDetail('${esc(s.id)}')">
              <title>${esc(s.id)}</title>
              <rect width="${DAG_NODE_W}" height="${DAG_NODE_H}" rx="6"
                    fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="1.2"/>
              <rect width="4" height="${DAG_NODE_H}" rx="2" fill="currentColor"/>
              <text x="12" y="20" font-size="11" font-weight="600" fill="var(--text)">
                ${esc(shortId)}
              </text>
              <text x="${DAG_NODE_W - 10}" y="20" text-anchor="end" font-size="10"
                    fill="var(--text-muted)">${esc(s.status)}</text>
              <text x="12" y="40" font-size="10.5" fill="var(--text-muted)">
                ${esc(title)}
              </text>
            </g>
          `;
        }).join('')}
      </svg>
    `;

    app.innerHTML = `
      <div class="section-header">
        <span class="section-header__title">Dependency graph — ${esc(projectDisplayName)}</span>
        <span class="section-header__count">${stories.length} HUs${anyEdges ? ` · ${edges.length} dep${edges.length === 1 ? '' : 's'}` : ' · no dependencies declared'}</span>
      </div>
      <div style="padding:8px;overflow:auto;max-height:calc(100vh - 140px)">
        ${svg}
      </div>
      ${!anyEdges ? `
        <div style="padding:14px 20px;color:var(--text-muted);font-size:0.85rem;max-width:720px;margin:12px auto">
          No HU in this plan declares <code>blocked_by</code>, so the DAG degenerates to a row of isolated nodes.
          Add dependencies via <code>kj plan</code> on generation or the modal <em>Edit</em> form
          (blocked_by editing is on the roadmap).
        </div>
      ` : ''}
    `;
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><div class="empty-state__title">Error loading graph</div><div class="empty-state__text">${esc(err.message)}</div></div>`;
  }
}

/**
 * Renders a single kanban column.
 * @param {string} title
 * @param {string} cssClass
 * @param {Array<object>} stories
 * @returns {string}
 */
function renderKanbanColumn(title, cssClass, stories) {
  // Empty lanes render the header (so the user keeps the 4-column
  // mental map) but no body placeholder — "No stories" text on four
  // empty columns was noise on fresh plans.
  return `
    <div class="kanban__column kanban__column--${cssClass}"${stories.length === 0 ? ' style="opacity:0.55"' : ''}>
      <div class="kanban__column-header">
        <span class="kanban__column-title">${title}</span>
        <span class="kanban__column-count">${stories.length}</span>
      </div>
      ${stories.map(renderStoryCard).join('')}
    </div>
  `;
}

/**
 * Renders a story card for the kanban board.
 * @param {object} story
 * @returns {string}
 */
function renderStoryCard(story) {
  const title = story.title || story.original_text || story.id;
  const antipatterns = story.antipatterns ? JSON.parse(story.antipatterns) : [];
  // Prefer denormalised counters stamped at sync time; fall back to
  // parsing the JSON blob for pre-migration rows so the card still shows
  // the AC count without a board DB nuke.
  const acCount = typeof story.ac_count === 'number'
    ? story.ac_count
    : (story.acceptance_criteria ? JSON.parse(story.acceptance_criteria).length : 0);
  const testCount = typeof story.test_count === 'number' ? story.test_count : 0;
  const blockedBy = story.blocked_by ? JSON.parse(story.blocked_by) : [];
  const initials = projectInitialsCache[story.project_id] || 'kj';
  const shortId = shortStoryId(story, initials);

  // Human-readable dep list: `lao-001, lao-003` instead of the raw HU ids.
  const shortDep = (depId) => {
    const m = /_(\d+)(?!.*\d)/.exec(depId);
    return `${initials}-${m ? m[1] : '?'}`;
  };

  return `
    <div class="story-card" onclick="showStoryDetail('${esc(story.id)}')">
      <div class="story-card__id" title="${esc(story.id)}">${esc(shortId)}</div>
      <div class="story-card__title">${esc(truncate(title, 100))}</div>
      <div class="story-card__meta" style="gap:10px">
        ${acCount > 0 ? `<span title="${acCount} acceptance criteria">📋 ${acCount} AC${acCount === 1 ? '' : 's'}</span>` : ''}
        ${testCount > 0 ? `<span title="${testCount} acceptance tests">🧪 ${testCount} test${testCount === 1 ? '' : 's'}</span>` : ''}
        ${story.quality_total !== null ? `
          <span class="story-card__score ${scoreClass(story.quality_total)}" title="INVEST score">
            ${story.quality_total}/60 ${qualityBar(story.quality_total)}
          </span>
        ` : ''}
      </div>
      ${blockedBy.length > 0 ? `
        <div class="story-card__meta" style="margin-top:4px;font-size:0.75rem;color:var(--text-muted)" title="This HU waits on: ${esc(blockedBy.join(', '))}">
          ⏳ waits for: ${blockedBy.map((d) => esc(shortDep(d))).join(', ')}
        </div>
      ` : (story.status === 'pending' || story.status === 'certified') ? `
        <div class="story-card__meta" style="margin-top:4px;font-size:0.75rem;color:var(--color-green)" title="No dependencies — runs first on the next 'Run plan'">
          🟢 ready to run
        </div>
      ` : ''}
      ${antipatterns.length > 0 ? `<div class="story-card__antipattern">${antipatterns.map((a) => esc(a)).join(', ')}</div>` : ''}
      <div class="story-card__meta" style="margin-top:6px">
        <span class="story-card__status status--${story.status}">${esc(story.status)}</span>
        <span class="story-card__time">${timeAgo(story.updated_at)}</span>
      </div>
    </div>
  `;
}

/**
 * Renders the sessions view.
 */
async function renderSessions() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="loading__spinner"></div><p>Loading sessions...</p></div>';

  try {
    let sessions;
    if (selectedProject) {
      sessions = await api(`/api/projects/${encodeURIComponent(selectedProject)}/sessions`);
    } else {
      sessions = await api('/api/sessions');
    }

    if (sessions.length === 0) {
      app.innerHTML = `
        <div class="section-header">
          <span class="section-header__title">Sessions</span>
          <span class="section-header__count">0 sessions</span>
        </div>
        ${renderEmptyState('No sessions found', 'KJ sessions will appear here when you run karajan.')}
      `;
      return;
    }

    app.innerHTML = `
      <div class="section-header">
        <span class="section-header__title">Sessions${selectedProject ? ` - ${esc(selectedProject)}` : ''}</span>
        <span class="section-header__count">${sessions.length} sessions</span>
      </div>
      <div class="sessions-list">
        ${sessions.map(renderSessionCard).join('')}
      </div>
    `;
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><div class="empty-state__title">Error loading sessions</div><div class="empty-state__text">${esc(err.message)}</div></div>`;
  }
}

/**
 * Renders a session card.
 * @param {object} session
 * @returns {string}
 */
function renderSessionCard(session) {
  const stages = session.stages_completed ? JSON.parse(session.stages_completed) : [];

  return `
    <div class="session-card" onclick="showSessionDetail('${esc(session.id)}')">
      <div class="session-card__header">
        <span class="session-card__id">${esc(session.id)}</span>
        <span class="session-card__status session-status--${session.status || 'unknown'}">${esc(session.status || 'unknown')}</span>
      </div>
      <div class="session-card__task">${esc(truncate(session.task, 150))}</div>
      <div class="session-card__meta">
        <span>Iterations: ${session.iterations || 0}</span>
        <span>Duration: ${formatDuration(session.duration_ms)}</span>
        <span>Stages: ${stages.join(', ') || '--'}</span>
        <span>${timeAgo(session.created_at)}</span>
      </div>
    </div>
  `;
}

/**
 * Renders an empty state component.
 * @param {string} title
 * @param {string} text
 * @returns {string}
 */
function renderEmptyState(title, text) {
  return `
    <div class="empty-state">
      <div class="empty-state__icon">&#9744;</div>
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
// `kj run --plan` is spawned as a detached child on the server side;
// stdout+stderr land in ~/.karajan/hu-board-runs/<planId>.log. The
// browser polls GET /api/plans/:planId/log?offset=<last-seen-size>
// every 2s and appends the delta into a <pre>. Polling stops when the
// dialog closes.

let logPollTimer = null;

function openLogViewer(planId) {
  if (logPollTimer) { clearTimeout(logPollTimer); logPollTimer = null; }

  const dlg = ensureDialog();
  dlg.innerHTML = `
    <div style="padding:12px 18px;border-bottom:1px solid var(--border);
                display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div style="font-weight:600">
        Run log
        <span style="font-family:var(--font-mono, monospace);font-size:0.8rem;
                     color:var(--text-muted);margin-left:8px">${esc(planId)}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span id="log-status" style="font-size:0.75rem;color:var(--text-muted)">connecting…</span>
        <button id="log-close" class="control-btn"
                style="padding:4px 12px;border:1px solid var(--border);
                       background:var(--bg-primary);color:var(--text);
                       border-radius:var(--radius-sm);cursor:pointer">
          Close
        </button>
      </div>
    </div>
    <pre id="log-body"
         style="margin:0;padding:14px 18px;max-height:60vh;min-height:240px;
                min-width:640px;max-width:80vw;overflow:auto;
                font-family:var(--font-mono, monospace);font-size:0.8rem;
                line-height:1.45;background:#0b0b0c;color:#e6e6e6;
                white-space:pre-wrap;word-break:break-word"></pre>
    <div style="padding:10px 18px;border-top:1px solid var(--border);
                font-size:0.75rem;color:var(--text-muted)">
      The run keeps going in the background even if you close this. Re-open anytime.
    </div>
  `;

  let offset = 0;
  const bodyEl = dlg.querySelector('#log-body');
  const statusEl = dlg.querySelector('#log-status');

  const stopPolling = () => {
    if (logPollTimer) { clearTimeout(logPollTimer); logPollTimer = null; }
  };
  const cleanup = () => {
    stopPolling();
    dlg.removeEventListener('close', cleanup);
  };

  dlg.querySelector('#log-close').addEventListener('click', () => {
    cleanup();
    if (dlg.open) dlg.close();
  });
  dlg.addEventListener('close', cleanup);

  async function tick() {
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/log?offset=${offset}`);
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
          // Auto-scroll if the user was already at the bottom before
          // this append; otherwise keep their scroll position so they
          // can read older lines without fighting the tail.
          const atBottom = bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 8;
          bodyEl.textContent += body.content;
          if (atBottom) bodyEl.scrollTop = bodyEl.scrollHeight;
        }
        offset = body.size;
        statusEl.textContent = `${(body.size / 1024).toFixed(1)} KB — live`;
      }
    } catch (err) {
      statusEl.textContent = `error: ${err.message}`;
    }
    logPollTimer = setTimeout(tick, 2000);
  }

  dlg.showModal();
  tick();
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

    content.innerHTML = `
      <div class="modal__header">
        <div>
          <div class="modal__title" title="${esc(story.id)}">${esc(shortId)}</div>
          <div class="modal__subtitle" style="font-size:0.75rem;color:var(--text-muted);font-family:monospace;margin-top:2px">${esc(story.id)}</div>
          <span class="story-card__status status--${story.status}">${esc(story.status)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${canEdit ? `
            <button id="edit-hu-btn" class="control-btn"
                    style="padding:6px 12px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem"
                    title="Edit title, scope, task type, and acceptance criteria">
              ✎ Edit
            </button>
          ` : ''}
          <button class="modal__close" onclick="closeModal()">&times;</button>
        </div>
      </div>


      <div class="modal__section">
        <div class="modal__section-title">Original Text</div>
        <div class="modal__field-value">${esc(story.original_text || 'N/A')}</div>
      </div>

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

      ${tests.length > 0 ? `
        <div class="modal__section">
          <div class="modal__section-title">Acceptance Tests (${tests.length})</div>
          <ul class="modal__ac-list">
            ${tests.map((t) => {
              if (typeof t === 'string') return `<li class="modal__ac-item">${esc(t)}</li>`;
              const label = t.name || t.title || t.id || '';
              const desc = t.description || t.scope || '';
              const given = t.given || (t.gherkin && t.gherkin.given);
              if (given) {
                const when = t.when || (t.gherkin && t.gherkin.when);
                const then = t.then || (t.gherkin && t.gherkin.then);
                return `<li class="modal__ac-item">
                  ${label ? `<strong>${esc(label)}</strong><br>` : ''}
                  <code>Given</code> ${esc(given)}<br>
                  <code>When</code> ${esc(when || '')}<br>
                  <code>Then</code> ${esc(then || '')}
                </li>`;
              }
              if (label || desc) {
                return `<li class="modal__ac-item">
                  ${label ? `<strong>${esc(label)}</strong>` : ''}
                  ${label && desc ? '<br>' : ''}
                  ${desc ? esc(desc) : ''}
                </li>`;
              }
              return `<li class="modal__ac-item"><code>${esc(JSON.stringify(t))}</code></li>`;
            }).join('')}
          </ul>
        </div>
      ` : ''}

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

  document.getElementById('edit-cancel').addEventListener('click', () => showStoryDetail(story.id));
  document.getElementById('edit-save').addEventListener('click', () => saveStoryEdits(story));
}

/**
 * Collect the form values, compute the diff against the story as it
 * was on modal open, and PATCH only the changed fields. Empty diff is
 * a no-op (close out of edit mode without an API call).
 * @param {object} story
 */
async function saveStoryEdits(story) {
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

/**
 * Shows the session detail modal.
 * @param {string} sessionId
 */
async function showSessionDetail(sessionId) {
  const backdrop = document.getElementById('modal-backdrop');
  const content = document.getElementById('modal-content');
  backdrop.classList.remove('hidden');

  content.innerHTML = '<div class="loading"><div class="loading__spinner"></div></div>';

  try {
    const session = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
    const checkpoints = session.checkpoints || [];
    const config = session.config_snapshot || {};
    const budget = session.budget || {};
    const startTime = session.created_at ? new Date(session.created_at).getTime() : 0;

    content.innerHTML = `
      <div class="modal__header">
        <div>
          <div class="modal__title">${esc(session.id)}</div>
          <span class="session-card__status session-status--${session.status}">${esc(session.status)}</span>
        </div>
        <button class="modal__close" onclick="closeModal()">&times;</button>
      </div>

      <div class="modal__section">
        <div class="modal__section-title">Task</div>
        <div class="modal__field-value" style="font-size:0.85rem">${esc(session.task || 'N/A')}</div>
      </div>

      <div class="modal__section">
        <div class="modal__section-title">Overview</div>
        <div class="stats-grid" style="margin-bottom:0">
          <div class="stat-card">
            <div class="stat-card__value">${session.iterations || 0}</div>
            <div class="stat-card__label">Iterations</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__value">${formatDuration(session.duration_ms)}</div>
            <div class="stat-card__label">Duration</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__value ${session.approved ? 'stat-card__value--green' : 'stat-card__value--yellow'}">${session.approved ? 'Yes' : 'No'}</div>
            <div class="stat-card__label">Approved</div>
          </div>
        </div>
      </div>

      ${config.coder || config.reviewer ? `
        <div class="modal__section">
          <div class="modal__section-title">Configuration</div>
          <div style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-secondary)">
            ${config.coder ? `Coder: ${esc(config.coder)}` : ''}
            ${config.reviewer ? ` | Reviewer: ${esc(config.reviewer)}` : ''}
          </div>
        </div>
      ` : ''}

      ${checkpoints.length > 0 ? `
        <div class="modal__section">
          <div class="modal__section-title">Timeline (${checkpoints.length} checkpoints)</div>
          <div class="timeline">
            ${checkpoints.map((cp) => {
              const elapsed = cp.at && startTime ? formatDuration(new Date(cp.at).getTime() - startTime) : '';
              const isOk = cp.ok === true || cp.approved === true;
              const isFail = cp.ok === false || cp.approved === false;
              const itemClass = isOk ? 'timeline__item--ok' : isFail ? 'timeline__item--fail' : 'timeline__item--info';

              let detail = '';
              if (cp.note) detail = cp.note;
              else if (cp.approved !== undefined) detail = cp.approved ? 'APPROVED' : `REJECTED (${cp.blocking_issues || 0} issues)`;
              else if (cp.reason) detail = cp.reason;
              else if (cp.ok !== undefined) detail = cp.ok ? 'PASSED' : 'FAILED';
              if (cp.provider) detail += ` [${cp.provider}]`;

              return `
                <div class="timeline__item ${itemClass}">
                  <span class="timeline__time">${elapsed}</span>
                  <div class="timeline__stage">[${esc(cp.stage)}] iter ${cp.iteration || 0}</div>
                  <div class="timeline__detail">${esc(detail)}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${budget.total_cost_usd !== undefined ? `
        <div class="modal__section">
          <div class="modal__section-title">Budget</div>
          <div style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-secondary)">
            Tokens: ${budget.total_tokens || 0} | Cost: $${(budget.total_cost_usd || 0).toFixed(4)}
          </div>
        </div>
      ` : ''}

      <details class="modal__section" style="margin-top:8px">
        <summary style="cursor:pointer;font-weight:600;font-size:0.85rem;color:var(--text-muted);padding:6px 0">
          Metadata
        </summary>
        <div style="padding-top:6px">
          <div class="modal__field"><span class="modal__field-label">Project:</span> ${esc(session.project_id)}</div>
          <div class="modal__field"><span class="modal__field-label">Created:</span> ${esc(session.created_at || '--')}</div>
          <div class="modal__field"><span class="modal__field-label">Updated:</span> ${esc(session.updated_at || '--')}</div>
        </div>
      </details>
    `;
  } catch (err) {
    content.innerHTML = `<div class="modal__header"><div class="modal__title">Error</div><button class="modal__close" onclick="closeModal()">&times;</button></div><p>${esc(err.message)}</p>`;
  }
}

/**
 * Closes the modal.
 */
function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
}

// ---- Native dialog helpers ----
//
// Project convention (and common sense): no window.alert / confirm / prompt.
// These use the browser's built-in modal chrome, steal focus, block script
// execution, and look foreign on every site. We use <dialog> instead —
// same blocking semantics without any of the downsides, and it composes
// with our own CSS variables so it matches the rest of the board.
//
// `showError` is the replacement for alert(); `showConfirm` for confirm().

/**
 * Lazily create (or reuse) the shared <dialog> singleton, so we don't
 * leak a new DOM node on every error.
 * @returns {HTMLDialogElement}
 */
function ensureDialog() {
  let dlg = document.getElementById('app-dialog');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'app-dialog';
  dlg.style.cssText = [
    'border: 1px solid var(--border)',
    'border-radius: var(--radius-sm)',
    'padding: 0',
    'min-width: 320px',
    'max-width: 560px',
    'background: var(--bg-secondary)',
    'color: var(--text)',
    'box-shadow: 0 10px 40px rgba(0,0,0,0.45)',
  ].join(';');
  document.body.appendChild(dlg);
  return dlg;
}

/**
 * Show a blocking error dialog. Returns a promise that resolves when the
 * user dismisses the dialog (Esc, backdrop click, or OK button).
 * @param {string} message
 * @param {object} [opts]
 * @param {string} [opts.title] - defaults to "Error"
 */
function showError(message, opts = {}) {
  return new Promise((resolve) => {
    const dlg = ensureDialog();
    const title = opts.title || 'Error';
    dlg.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);
                  font-weight:600;color:var(--color-red,#ef4444)">
        ${esc(title)}
      </div>
      <div style="padding:16px 18px;font-size:0.9rem;line-height:1.5;
                  white-space:pre-wrap">${esc(message)}</div>
      <div style="padding:12px 18px;border-top:1px solid var(--border);
                  text-align:right">
        <button id="app-dialog-ok" class="control-btn"
                style="padding:6px 16px;border:1px solid var(--border);
                       background:var(--bg-primary);color:var(--text);
                       border-radius:var(--radius-sm);cursor:pointer">
          OK
        </button>
      </div>
    `;
    const done = () => {
      if (dlg.open) dlg.close();
      resolve();
    };
    dlg.addEventListener('close', done, { once: true });
    dlg.querySelector('#app-dialog-ok').addEventListener('click', done, { once: true });
    dlg.showModal();
  });
}

/**
 * Show a blocking confirm dialog. Resolves to true when the user clicks
 * the primary action, false otherwise (cancel / Esc / backdrop click).
 * @param {string} message
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @param {string} [opts.okLabel]
 * @param {string} [opts.cancelLabel]
 * @param {boolean} [opts.destructive] - red OK button for deletions
 * @returns {Promise<boolean>}
 */
function showConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    const dlg = ensureDialog();
    const title = opts.title || 'Confirm';
    const okLabel = opts.okLabel || 'OK';
    const cancelLabel = opts.cancelLabel || 'Cancel';
    const okColor = opts.destructive ? 'var(--color-red,#ef4444)' : 'var(--color-green)';
    dlg.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:600">
        ${esc(title)}
      </div>
      <div style="padding:16px 18px;font-size:0.9rem;line-height:1.5;
                  white-space:pre-wrap">${esc(message)}</div>
      <div style="padding:12px 18px;border-top:1px solid var(--border);
                  display:flex;justify-content:flex-end;gap:8px">
        <button id="app-dialog-cancel" class="control-btn"
                style="padding:6px 14px;border:1px solid var(--border);
                       background:var(--bg-primary);color:var(--text);
                       border-radius:var(--radius-sm);cursor:pointer">
          ${esc(cancelLabel)}
        </button>
        <button id="app-dialog-ok" class="control-btn"
                style="padding:6px 14px;border:none;background:${okColor};
                       color:#fff;border-radius:var(--radius-sm);cursor:pointer">
          ${esc(okLabel)}
        </button>
      </div>
    `;
    let answer = false;
    const finish = () => {
      if (dlg.open) dlg.close();
      resolve(answer);
    };
    dlg.addEventListener('close', finish, { once: true });
    dlg.querySelector('#app-dialog-ok').addEventListener('click', () => { answer = true; finish(); }, { once: true });
    dlg.querySelector('#app-dialog-cancel').addEventListener('click', () => { answer = false; finish(); }, { once: true });
    dlg.showModal();
  });
}

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
    // Keep the "All Projects" option
    select.innerHTML = '<option value="">All Projects</option>';
    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      select.appendChild(opt);
    }
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

// Initial load — sync disk data first so new batches are visible
triggerSync().then(() => {
  populateProjectSelect();
  handleRoute();
});

// Auto-refresh every 10 seconds (with sync to catch new batches)
refreshInterval = setInterval(async () => {
  if (document.getElementById('modal-backdrop').classList.contains('hidden')) {
    await triggerSync();
    await populateProjectSelect();
    render();
  }
}, 10000);
