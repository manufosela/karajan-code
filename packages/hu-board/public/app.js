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
        ${lastOpenedLog ? `
          <button class="control-btn" id="view-log-btn"
                  style="${isRunning ? '' : 'margin-left:auto;'}padding:6px 12px;font-size:0.85rem;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;"
                  title="Re-open the log of the most recent run/command">
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
    if (viewLogBtn && lastOpenedLog) {
      viewLogBtn.addEventListener('click', () => openGenericLogPanel({
        id: lastOpenedLog.id,
        label: lastOpenedLog.label,
        tailUrl: lastOpenedLog.tailUrl,
      }));
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

  // Tests-first flag: a HU with zero acceptance_tests has no contract
  // for the coder, so `Run plan` will refuse to execute it. Surface
  // this on the card so the user edits the HU before trying to run.
  const missingTestContract = testCount === 0 && ['pending', 'certified'].includes(story.status);

  return `
    <div class="story-card" onclick="showStoryDetail('${esc(story.id)}')">
      <div class="story-card__id" title="${esc(story.id)}">${esc(shortId)}</div>
      <div class="story-card__title">${esc(truncate(title, 100))}</div>
      <div class="story-card__meta" style="gap:10px">
        ${acCount > 0 ? `<span title="${acCount} acceptance criteria">📋 ${acCount} AC${acCount === 1 ? '' : 's'}</span>` : ''}
        ${testCount > 0 ? `<span title="${testCount} acceptance tests declared">✅ ${testCount} test${testCount === 1 ? '' : 's'}</span>` : ''}
        ${story.spec_section ? `<span title="Implements SPEC ${esc(story.spec_section)}" style="font-family:var(--font-mono, monospace)">📖 §${esc(story.spec_section)}</span>` : ''}
        ${story.quality_total !== null ? `
          <span class="story-card__score ${scoreClass(story.quality_total)}" title="INVEST score">
            ${story.quality_total}/60 ${qualityBar(story.quality_total)}
          </span>
        ` : ''}
      </div>
      ${missingTestContract ? `
        <div class="story-card__meta" style="margin-top:4px;font-size:0.75rem;color:var(--color-yellow,#eab308);font-weight:600" title="This HU has no acceptance_tests declared — Run plan will reject it until you add at least one.">
          ⚠ missing test contract
        </div>
      ` : ''}
      ${blockedBy.length > 0 ? `
        <div class="story-card__meta" style="margin-top:4px;font-size:0.75rem;color:var(--text-muted)" title="This HU waits on: ${esc(blockedBy.join(', '))}">
          ⏳ waits for: ${blockedBy.map((d) => esc(shortDep(d))).join(', ')}
        </div>
      ` : (story.status === 'pending' || story.status === 'certified') && !missingTestContract ? `
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

// Generalised across plan runs AND ⚡ launcher commands: the ▶ Run
// plan button populates this with the run's logPath, and the
// command launcher does the same with its own commandId. The 📜
// View log button in the section header reads from here so it
// re-opens whichever was most recently launched.
let lastOpenedLog = null;     // { id, label, tailUrl(offset) }

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

// Map common ANSI SGR codes to inline CSS. Anything we don't know is
// stripped silently (still removes the escape, just doesn't colour).
// We render into a styled <pre> so newlines + spaces preserve.
const ANSI_SGR = {
  1: 'font-weight:bold',
  2: 'opacity:0.65',
  3: 'font-style:italic',
  4: 'text-decoration:underline',
  30: 'color:#1f2937', 31: 'color:#f87171', 32: 'color:#4ade80',
  33: 'color:#fbbf24', 34: 'color:#60a5fa', 35: 'color:#c084fc',
  36: 'color:#22d3ee', 37: 'color:#e5e7eb',
  90: 'color:#9ca3af', 91: 'color:#fca5a5', 92: 'color:#86efac',
  93: 'color:#fde68a', 94: 'color:#93c5fd', 95: 'color:#d8b4fe',
  96: 'color:#67e8f9', 97: 'color:#f3f4f6',
};

/**
 * Map an xterm 256-colour index to a CSS rgb(). 0-15 = the 16 standard
 * + bright colours; 16-231 = the 6x6x6 RGB cube; 232-255 = grayscale.
 */
function ansi256ToCss(n) {
  if (n < 0 || n > 255) return 'inherit';
  const std = [
    '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
    '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
  ];
  if (n < 16) return std[n];
  if (n < 232) {
    const idx = n - 16;
    const r = Math.floor(idx / 36);
    const g = Math.floor(idx / 6) % 6;
    const b = idx % 6;
    const v = (c) => (c === 0 ? 0 : 55 + c * 40);
    return `rgb(${v(r)},${v(g)},${v(b)})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

const ESC_CHARS = new Set([0x1B, 0x241B]);    // real ESC + Unicode "Symbol For Escape"
const HTML_ESC = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Convert text containing ANSI SGR escapes into HTML with inline-styled
 * spans. The previous implementation had two bugs that turned the log
 * into unreadable garbage:
 *
 *   1. It searched for `[` (just the bracket) instead of `ESC + [`,
 *      so the ESC byte itself was sliced into the output. The browser
 *      then rendered it as the literal substitute character (escape).
 *   2. It only knew the 16-colour codes (30-37, 90-97). Karajan's
 *      banner uses 24-bit RGB (`38;2;r;g;b`) and codex emits
 *      256-colour (`38;5;n`); both showed as plain unstyled text with
 *      the escape sequences leaking through.
 *
 * Also accepts U+241B "Symbol For Escape" which some loggers /
 * clipboards substitute for the raw 0x1B byte.
 *
 * @param {string} text
 * @returns {string} safe HTML
 */
function ansiToHtml(text) {
  const src = String(text);
  const N = src.length;
  let out = '';
  let openSpans = 0;
  let i = 0;

  while (i < N) {
    const code = src.charCodeAt(i);
    // Not an escape: fast-batch the literal run up to the next escape.
    if (!ESC_CHARS.has(code)) {
      let j = i + 1;
      while (j < N && !ESC_CHARS.has(src.charCodeAt(j))) j += 1;
      out += HTML_ESC(src.slice(i, j));
      i = j;
      continue;
    }
    // Escape but not followed by `[` -- drop the lone escape byte so
    // it doesn't render as the substitute character.
    if (src[i + 1] !== '[') { i += 1; continue; }
    const endM = src.indexOf('m', i + 2);
    if (endM === -1) { i += 1; continue; }
    const params = src.slice(i + 2, endM).split(';').map((n) => Number(n) || 0);
    let k = 0;
    while (k < params.length) {
      const c = params[k];
      if (c === 0) {
        while (openSpans > 0) { out += '</span>'; openSpans -= 1; }
        k += 1;
      } else if ((c === 38 || c === 48) && params[k + 1] === 2 && params.length >= k + 5) {
        // 24-bit truecolor: 38;2;r;g;b (foreground) or 48;2;r;g;b (background)
        const r = params[k + 2], g = params[k + 3], b = params[k + 4];
        const prop = c === 38 ? 'color' : 'background-color';
        out += `<span style="${prop}:rgb(${r},${g},${b})">`;
        openSpans += 1;
        k += 5;
      } else if ((c === 38 || c === 48) && params[k + 1] === 5 && params.length >= k + 3) {
        // 256-colour palette: 38;5;n / 48;5;n
        const prop = c === 38 ? 'color' : 'background-color';
        out += `<span style="${prop}:${ansi256ToCss(params[k + 2])}">`;
        openSpans += 1;
        k += 3;
      } else if (ANSI_SGR[c]) {
        out += `<span style="${ANSI_SGR[c]}">`;
        openSpans += 1;
        k += 1;
      } else {
        k += 1;                             // unknown -- silently drop
      }
    }
    i = endM + 1;
  }
  while (openSpans > 0) { out += '</span>'; openSpans -= 1; }
  return out;
}

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
  // Position explicitly: showModal() defaults to centered, but when
  // inner content (a wide textarea, the command launcher's form,
  // etc.) pushes past the dialog's natural width Chrome falls back
  // to top-left. Pinning position+transform here makes centering
  // robust regardless of inner content size. We also reset the
  // browser's default 1em margin on <dialog> which would otherwise
  // offset the transform.
  dlg.style.cssText = [
    'position: fixed',
    'top: 50%',
    'left: 50%',
    'transform: translate(-50%, -50%)',
    'margin: 0',
    'border: 1px solid var(--border)',
    'border-radius: var(--radius-sm)',
    'padding: 0',
    'min-width: 320px',
    'max-width: min(720px, 92vw)',
    'max-height: 90vh',
    'overflow: auto',
    'background: var(--bg-secondary)',
    'color: var(--text)',
    'box-shadow: 0 10px 40px rgba(0,0,0,0.45)',
  ].join(';');
  // Inject a backdrop dim rule once. Inline styles can't target the
  // ::backdrop pseudo-element, so we use a one-off <style> tag.
  if (!document.getElementById('app-dialog-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'app-dialog-style';
    styleEl.textContent =
      '#app-dialog::backdrop { background: rgba(0,0,0,0.55); }';
    document.head.appendChild(styleEl);
  }
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

// ---- Command launcher modal ----
//
// Opens a small form inside the existing <dialog> singleton with a
// command picker (plan / architect / clean) and the appropriate
// fields per command. Submit POSTs to /api/commands/:command, the
// server spawns a detached `kj` child, and we open the existing log
// viewer (re-uses openLogViewer's tail loop, just pointed at the
// new generic /api/runs/:commandId/log endpoint).

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

    // Default: data changed somewhere; nudge the current view.
    if (sseRefreshTimer) clearTimeout(sseRefreshTimer);
    sseRefreshTimer = setTimeout(() => refreshCurrentView(e.data), 150);
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

// ---- Prompt modal ----
//
// The runner publishes a prompt JSON file when it needs an answer
// (Solomon escalations, max-iterations decisions, anything wired to
// askQuestion) and there's no TTY to ask through. The board surfaces
// the prompt as a modal dialog with a text input. When the user
// answers, we POST back; the runner sees the answer file and
// resolves.

let activePromptId = null;

function showPromptModal(prompt) {
  if (!prompt?.promptId) return;
  if (activePromptId === prompt.promptId) return;
  activePromptId = prompt.promptId;
  const dlg = ensureDialog();
  const ctxBlock = prompt.context
    ? `<details style="margin-top:8px">
         <summary style="cursor:pointer;color:var(--text-muted);font-size:0.85rem">Context</summary>
         <pre style="white-space:pre-wrap;font-size:0.78rem;background:var(--bg-primary);padding:8px;border-radius:var(--radius-sm);overflow:auto;max-height:240px">${esc(JSON.stringify(prompt.context, null, 2))}</pre>
       </details>`
    : '';
  dlg.innerHTML = `
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:600;display:flex;align-items:center;gap:10px">
      <span>❓ Karajan needs an answer</span>
      ${prompt.sessionId ? `<span style="font-family:var(--font-mono, monospace);font-size:0.75rem;color:var(--text-muted)">${esc(prompt.sessionId)}</span>` : ''}
    </div>
    <div style="padding:14px 18px">
      <div style="white-space:pre-wrap;font-size:0.95rem;line-height:1.55">${esc(prompt.question)}</div>
      ${ctxBlock}
      <textarea id="prompt-answer" rows="3"
                placeholder="Type your answer (or 'stop' to abort the run)"
                style="margin-top:12px;width:100%;padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-family:inherit;font-size:0.9rem;line-height:1.5;resize:vertical;box-sizing:border-box"></textarea>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-top:1px solid var(--border);gap:8px">
      <span style="font-size:0.75rem;color:var(--text-muted)">
        The runner is blocked waiting for this answer. Closing the dialog without answering aborts the prompt (run stops).
      </span>
      <div style="display:flex;gap:8px">
        <button id="prompt-stop" type="button" class="control-btn"
                style="padding:6px 14px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer">
          Stop
        </button>
        <button id="prompt-send" type="button" class="control-btn"
                style="padding:6px 14px;border:none;background:var(--color-green);color:#fff;border-radius:var(--radius-sm);cursor:pointer;font-weight:600">
          Send
        </button>
      </div>
    </div>
  `;

  const send = async (rawAnswer) => {
    const answer = String(rawAnswer ?? '');
    try {
      await fetch(`/api/prompts/${encodeURIComponent(prompt.promptId)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
    } catch (err) {
      await showError(`Could not deliver answer: ${err.message}`, { title: 'Prompt delivery failed' });
      return;
    }
    activePromptId = null;
    if (dlg.open) dlg.close();
  };

  dlg.querySelector('#prompt-send').addEventListener('click', () => {
    send(dlg.querySelector('#prompt-answer').value.trim());
  });
  dlg.querySelector('#prompt-stop').addEventListener('click', () => send('stop'));

  // Esc / backdrop click also count as Stop so the user can't accidentally
  // leave the runner blocked.
  dlg.addEventListener('close', () => {
    if (activePromptId === prompt.promptId) {
      activePromptId = null;
      // Best-effort stop; ignore errors if the runner already moved on.
      fetch(`/api/prompts/${encodeURIComponent(prompt.promptId)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'stop' }),
      }).catch(() => {});
    }
  }, { once: true });

  dlg.showModal();
  setTimeout(() => dlg.querySelector('#prompt-answer')?.focus(), 50);
}

function closePromptModalIfMatches(promptId) {
  if (activePromptId !== promptId) return;
  activePromptId = null;
  const dlg = document.getElementById('app-dialog');
  if (dlg && dlg.open) dlg.close();
}

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

// Auto-refresh every 10 seconds (with sync to catch new batches)
refreshInterval = setInterval(async () => {
  if (document.getElementById('modal-backdrop').classList.contains('hidden')) {
    await triggerSync();
    await populateProjectSelect();
    render();
  }
}, 10000);
