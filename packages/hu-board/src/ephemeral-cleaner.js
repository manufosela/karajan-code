/**
 * Ephemeral project cleaner for the HU Board (board-polish #3,
 * KJC-TSK-0371 — dogfooding 2026-05-07).
 *
 * Why this exists
 * ===============
 *
 * Every `kj run` against a throwaway directory (`/tmp/kj-test-1`,
 * `/tmp/demo-foo`, ad-hoc scratch projects under `tmp_*`) produces
 * a board project that hangs around forever, even after the user
 * has long since rm-rf'd the source tree. After 12 days of
 * dogfooding the board ended up with 30+ "kj-test-N" projects
 * the user couldn't tell apart from real ones — exactly the
 * "noise on the demo" risk the user flagged on 2026-05-07.
 *
 * Heuristic (per the user's spec on the same session, "solución
 * c — heurística + flag visible"):
 *
 *   1. Project is ephemeral when:
 *        a) `is_test = 1` (user explicitly marked it test), OR
 *        b) project id matches /^(tmp_|test_|demo_|kj-test-)/i
 *           AND `is_test IS NULL` (no override).
 *   2. AND last_activity is older than `ttlHours` (default 24h).
 *
 *   3. Override: when `is_test = 0` (user clicked "keep it"), the
 *      project is NEVER deleted, even if the heuristic would match.
 *
 * What "cleanup" means: DELETE the project row + cascade-delete its
 * stories and sessions, ADD a project tombstone, and rm-rf the
 * on-disk dirs (`hu-stories/<sid>/`, `sessions/<sid>/`,
 * `~/.kj/plans/<projectId>/`). Without the tombstone + fs cleanup,
 * the very next chokidar `add` event or `fullScan` would re-import
 * those files as a brand-new project (KJC-BUG-0055).
 */

import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { addTombstone, getKjHome } from "./db.js";

const DEFAULT_TTL_HOURS = 24;
const EPHEMERAL_ID_PATTERNS = [
  /^tmp_/i,
  /^test_/i,
  /^demo_/i,
  /^kj-test-/i,
  /^auto-tmp_/i,    // also covers auto-batch projects derived from /tmp/
  /^auto-test_/i,
  /^auto-demo_/i,
  // KJC-TSK-0377: stray session/plan-prefixed projects accumulate during
  // dogfooding when a kj run is invoked without a proper projectDir.
  // The HU Board's sync_*File handlers create a placeholder project row
  // with `id = session_id` or `id = plan_id`, which after 24h of
  // inactivity is the same kind of zombi the other patterns target.
  /^s_/i,
  /^plan-/i,
];

/**
 * Decide whether a single project row qualifies as an ephemeral
 * candidate ready for deletion at `now`. Pure function — no I/O.
 *
 * The matrix:
 *   is_test = 1         → ephemeral (user marked it)
 *   is_test = 0         → not ephemeral, EVER (user override wins)
 *   is_test = NULL/und. → fall back to id-pattern heuristic
 *   too recent          → not ephemeral (still in use)
 *
 * @param {{ id: string, last_activity?: string|null, first_seen?: string|null,
 *           is_test?: number|null }} project
 * @param {{ now: number, ttlHours: number }} ctx
 * @returns {{ ephemeral: boolean, reason?: string }}
 */
export function classifyEphemeral(project, ctx) {
  if (!project || !project.id) return { ephemeral: false };
  // Explicit user override always wins. is_test=0 means "keep it".
  if (project.is_test === 0) return { ephemeral: false };

  const idMatch = EPHEMERAL_ID_PATTERNS.some((re) => re.test(project.id));
  const explicitTest = project.is_test === 1;
  if (!idMatch && !explicitTest) return { ephemeral: false };

  const refIso = project.last_activity || project.first_seen;
  if (!refIso) return { ephemeral: false };
  const refTs = new Date(refIso).getTime();
  if (Number.isNaN(refTs)) return { ephemeral: false };
  const ageHours = (ctx.now - refTs) / 3_600_000;
  if (ageHours <= 0) return { ephemeral: false };
  if (ageHours < ctx.ttlHours) return { ephemeral: false };

  const why = explicitTest ? "is_test=1" : "id heuristic";
  return {
    ephemeral: true,
    reason: `${why}, ${ageHours.toFixed(1)}h inactive (>= ${ctx.ttlHours}h)`,
  };
}

/**
 * Filter a list of project rows down to the ephemeral ones. Pure.
 *
 * @param {Array<object>} projects
 * @param {{ now?: number, ttlHours?: number }} [opts]
 * @returns {Array<{ project: object, reason: string }>}
 */
export function findEphemeralProjects(projects, opts = {}) {
  const ctx = {
    now: opts.now ?? Date.now(),
    ttlHours: opts.ttlHours ?? DEFAULT_TTL_HOURS,
  };
  const out = [];
  for (const project of projects || []) {
    const verdict = classifyEphemeral(project, ctx);
    if (verdict.ephemeral) out.push({ project, reason: verdict.reason });
  }
  return out;
}

/**
 * Cascade-delete every ephemeral project at `now`. Side-effecting.
 * Returns the list of cleaned projects so the server can log them.
 *
 * Idempotent: cleanup deletes the rows outright, so running twice
 * has no effect on the second pass.
 *
 * @param {object} deps
 * @param {object} deps.db        better-sqlite3 Database handle
 * @param {object} [deps.opts]    threshold overrides
 * @param {Function} [deps.now]   () => number, for tests
 * @returns {Array<{ id: string, reason: string, stories_deleted: number, sessions_deleted: number }>}
 */
export function cleanupEphemeralProjects({
  db,
  opts = {},
  now = () => Date.now(),
  // Deps are injectable so the legacy in-memory tests (which never
  // call `initDb()`) can pass no-op stubs and still verify the
  // cascade-delete logic. Production callers omit them and get the
  // real persistence + fs side-effects.
  tombstone = (type, id, o) => {
    try { addTombstone(type, id, o); } catch { /* DB not initialised (test) */ }
  },
  kjHome = () => {
    try { return getKjHome(); } catch { return null; }
  },
} = {}) {
  if (!db) return [];
  const allProjects = db
    .prepare("SELECT id, last_activity, first_seen, is_test FROM projects")
    .all();
  const candidates = findEphemeralProjects(allProjects, { ...opts, now: now() });
  if (candidates.length === 0) return [];

  const delStories = db.prepare("DELETE FROM stories WHERE project_id = ?");
  const delSessions = db.prepare("DELETE FROM sessions WHERE project_id = ?");
  const delProject = db.prepare("DELETE FROM projects WHERE id = ?");

  const selStories = db.prepare("SELECT id FROM stories WHERE project_id = ?");
  const selSessions = db.prepare("SELECT id FROM sessions WHERE project_id = ?");
  const plansRoot = process.env.KJ_PLANS_DIR
    || path.join(homedir(), ".kj", "plans");
  const home = kjHome();
  const cleaned = [];
  for (const { project, reason } of candidates) {
    const storyIds = selStories.all(project.id).map((r) => r.id);
    const sessionIds = selSessions.all(project.id).map((r) => r.id);
    const fsPaths = home
      ? [
          ...storyIds.map((sid) => path.join(home, "hu-stories", sid)),
          ...sessionIds.map((sid) => path.join(home, "sessions", sid)),
          path.join(plansRoot, project.id),
        ]
      : [];
    db.transaction(() => {
      delStories.run(project.id);
      delSessions.run(project.id);
      delProject.run(project.id);
    })();
    // Tombstone the lot + best-effort rm-rf. If the fs op fails (perm
    // error, file in use) we still keep the tombstone — that alone is
    // enough to stop sync.js from re-importing on the next chokidar
    // event, and `fullScan` will retry the rm-rf at next boot.
    tombstone("project", project.id, { source: "ephemeral-cleaner", fsPaths });
    for (const sid of storyIds) tombstone("story", sid, { source: "ephemeral-cleaner" });
    for (const sid of sessionIds) tombstone("session", sid, { source: "ephemeral-cleaner" });
    for (const p of fsPaths) {
      try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    cleaned.push({
      id: project.id,
      reason,
      stories_deleted: storyIds.length,
      sessions_deleted: sessionIds.length,
    });
  }
  return cleaned;
}
