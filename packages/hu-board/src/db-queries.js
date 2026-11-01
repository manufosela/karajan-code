// KJC-TSK-0542: the read side of the board DB (projects, stories, sessions, cost, dashboard),
// re-exported by db.js.
import { getDb } from './db-connection.js';

/**
 * Returns all projects with aggregated stats.
 * @returns {Array<object>}
 */
export function getProjects() {
  return getDb().prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stories s WHERE s.project_id = p.id) AS story_count,
      (SELECT COUNT(*) FROM stories s WHERE s.project_id = p.id AND s.status = 'certified') AS certified_count,
      (SELECT COUNT(*) FROM stories s WHERE s.project_id = p.id AND s.status = 'pending') AS pending_count,
      (SELECT COUNT(*) FROM sessions ss WHERE ss.project_id = p.id) AS session_count
    FROM projects p
    ORDER BY p.last_activity DESC
  `).all();
}

/**
 * Returns stories for a specific project.
 * @param {string} projectId
 * @returns {Array<object>}
 */
/**
 * Fetch all stories of a project ordered by plan_order ASC (roots first,
 * dependents last — matches what `kj run --plan` will actually execute)
 * and falling back to updated_at DESC for legacy rows that never had
 * plan_order stamped.
 */
export function getStoriesByProject(projectId) {
  return getDb().prepare(`
    SELECT * FROM stories WHERE project_id = ?
    ORDER BY plan_order IS NULL, plan_order ASC, updated_at DESC
  `).all(projectId);
}

/**
 * Aggregate $ cost for a project (KJC-TSK-0516, Cost E).
 * Sums stories.cost_usd, groups by plan_id ('unassigned' for NULL).
 * Returns null if project does not exist; otherwise an object with
 * totalUsd=0 and byPlan=[] when no stories carry cost_usd yet.
 * @param {string} projectId
 * @returns {{ totalUsd:number, byPlan:Array<{planId:string,totalUsd:number,huCount:number}>, unknownModelTokens:object, currency:string } | null}
 */
export function getProjectCost(projectId) {
  const project = getDb()
    .prepare('SELECT id FROM projects WHERE id = ?')
    .get(projectId);
  if (!project) return null;

  // Φ0-G: cached_tokens / tokens_in are nullable independently of
  // cost_usd, so we read all three columns but keep cost as the
  // primary filter (a row with only cache telemetry but no $ should
  // not appear in the per-plan totals — cost rules the byPlan list).
  const rows = getDb()
    .prepare(
      `SELECT plan_id, cost_usd, cached_tokens, tokens_in FROM stories
       WHERE project_id = ? AND cost_usd IS NOT NULL`
    )
    .all(projectId);

  const round4 = (n) => Math.round(n * 10000) / 10000;
  const byPlanMap = new Map();
  let totalUsd = 0;
  let totalCached = 0;
  let totalTokensIn = 0;
  for (const r of rows) {
    const planId = r.plan_id || 'unassigned';
    const cost = Number(r.cost_usd);
    if (!Number.isFinite(cost)) continue;
    totalUsd += cost;
    const cached = Number(r.cached_tokens);
    const tin = Number(r.tokens_in);
    if (Number.isFinite(cached) && cached >= 0) totalCached += cached;
    if (Number.isFinite(tin) && tin >= 0) totalTokensIn += tin;
    const cur = byPlanMap.get(planId) || { planId, totalUsd: 0, huCount: 0, cachedTokens: 0, tokensIn: 0 };
    cur.totalUsd += cost;
    cur.huCount += 1;
    if (Number.isFinite(cached) && cached >= 0) cur.cachedTokens += cached;
    if (Number.isFinite(tin) && tin >= 0) cur.tokensIn += tin;
    byPlanMap.set(planId, cur);
  }

  const ratio = (cached, tin) => tin > 0 ? Math.round((cached / tin) * 1000) / 10 : null;
  const byPlan = Array.from(byPlanMap.values())
    .map((p) => ({
      planId: p.planId,
      totalUsd: round4(p.totalUsd),
      huCount: p.huCount,
      cachedTokens: p.cachedTokens,
      tokensIn: p.tokensIn,
      cachedRatioPct: ratio(p.cachedTokens, p.tokensIn),
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd);

  return {
    totalUsd: round4(totalUsd),
    byPlan,
    cachedTokens: totalCached,
    tokensIn: totalTokensIn,
    cachedRatioPct: ratio(totalCached, totalTokensIn),
    unknownModelTokens: { tokensIn: 0, tokensOut: 0, models: [] },
    currency: 'USD',
  };
}

/**
 * Returns full story detail including context requests.
 * @param {string} storyId
 * @returns {object | null}
 */
export function getStoryDetail(storyId) {
  const story = getDb().prepare('SELECT * FROM stories WHERE id = ?').get(storyId);
  if (!story) return null;

  const contextRequests = getDb().prepare(
    'SELECT * FROM context_requests WHERE story_id = ? ORDER BY requested_at DESC'
  ).all(storyId);

  return { ...story, context_requests: contextRequests };
}

/**
 * Returns sessions for a specific project.
 *
 * The `project_name` column is joined in so the UI can show a human
 * label like `tmp_kj-test-4 · trivial(doc) · 08:35` instead of just
 * the cryptic `s_2026-05-07T...` id.
 *
 * @param {string} projectId
 * @returns {Array<object>}
 */
export function getSessionsByProject(projectId) {
  return getDb().prepare(`
    SELECT s.id, s.project_id, s.task, s.status, s.created_at, s.updated_at,
           s.iterations, s.duration_ms, s.approved, s.stages_completed,
           p.name AS project_name
    FROM sessions s
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.project_id = ?
    ORDER BY s.created_at DESC
  `).all(projectId);
}

/**
 * Returns full session detail (with the joined project_name).
 * @param {string} sessionId
 * @returns {object | null}
 */
export function getSessionDetail(sessionId) {
  return getDb().prepare(`
    SELECT s.*, p.name AS project_name
    FROM sessions s
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.id = ?
  `).get(sessionId);
}

/**
 * Returns global dashboard statistics.
 * @returns {object}
 */
export function getDashboardStats() {
  const db = getDb();
  const totalStories = db.prepare('SELECT COUNT(*) AS count FROM stories').get().count;
  const certifiedStories = db.prepare("SELECT COUNT(*) AS count FROM stories WHERE status = 'certified'").get().count;
  const pendingStories = db.prepare("SELECT COUNT(*) AS count FROM stories WHERE status = 'pending'").get().count;
  const doneStories = db.prepare("SELECT COUNT(*) AS count FROM stories WHERE status = 'done'").get().count;
  const needsContextStories = db.prepare("SELECT COUNT(*) AS count FROM stories WHERE status = 'needs_context'").get().count;
  const avgQuality = db.prepare('SELECT AVG(quality_total) AS avg FROM stories WHERE quality_total IS NOT NULL').get().avg;
  const totalSessions = db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count;
  const approvedSessions = db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE approved = 1').get().count;
  const totalProjects = db.prepare('SELECT COUNT(*) AS count FROM projects').get().count;

  return {
    total_stories: totalStories,
    certified_stories: certifiedStories,
    pending_stories: pendingStories,
    done_stories: doneStories,
    needs_context_stories: needsContextStories,
    avg_quality: avgQuality ? Math.round(avgQuality * 10) / 10 : null,
    total_sessions: totalSessions,
    approved_sessions: approvedSessions,
    total_projects: totalProjects,
  };
}
