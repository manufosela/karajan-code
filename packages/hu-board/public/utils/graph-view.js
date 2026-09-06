// KJC-TSK-0501 step 6/8 — Graph (DAG) view: layout helpers + renderer.
//
// Classic script (no exports). Loaded by index.html before app.js so
// function declarations hoist to the script-level lexical environment
// and app.js can call renderGraph() from the view router.
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
//
// Globals consumed from earlier scripts / app.js:
//   - api()                       (utils/api.js)
//   - esc()                       (app.js)
//   - renderEmptyState()          (app.js)
//   - resolveProjectMeta()        (app.js)
//   - projectNameCache, projectInitialsCache (mutable, app.js)
//   - humaniseProjectName(), shortStoryId(), truncate() (app.js)
//   - showStoryDetail()           (app.js)
//   - selectedProject (mutable global, app.js)

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
      'The dependency graph is per-project. Pick one on the Dashboard and I will draw its HU DAG.'
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
