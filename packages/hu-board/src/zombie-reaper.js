/**
 * Zombie session reaper for the HU Board (board-polish #2,
 * KJC dogfooding 2026-05-07).
 *
 * Why this exists
 * ===============
 *
 * Sessions in the SQLite db can stay "in flight" forever when the
 * orchestrator process dies between iterations: their `status` stays
 * `coding` / `stalled` / `paused`, the UI keeps surfacing them as
 * actionable, and `kj board start` weeks later still pops a
 * "Karajan needs an answer" modal for a checkpoint nobody owns
 * anymore.
 *
 * Concretely, on 2026-05-07 the user opened the board on a fresh
 * `kj board start` and saw the popup of an HU from 2026-04-29 — that
 * was 8 days dead. The fix per his explicit mandate:
 *
 *   "No puede quedarse nada zombie. Debe haber algun sistema que lo
 *    compruebe al arrancar y mate esos zombies."
 *
 * Thresholds (per his decision in the same session):
 *   - status in (coding | stalled) and >= 6h since updated_at  → reap
 *   - status === paused and >= 24h since updated_at            → reap
 *   - everything else                                          → skip
 *
 * What "reap" means: set the session's `status` column to `failed`
 * and append a structured checkpoint of the form
 *   { stage: 'zombie-reap', reason: <reason>, at: <iso> }
 * to the existing `checkpoints` JSON blob, so the audit trail
 * survives. The session row stays in place (we don't DELETE — the
 * user can still inspect what happened).
 */

const DEFAULT_CODING_HOURS = 6;
const DEFAULT_PAUSED_HOURS = 24;
const CODING_LIKE_STATUSES = new Set(["coding", "stalled", "running", "in_progress"]);
const PAUSED_STATUSES = new Set(["paused", "checkpoint", "awaiting_answer"]);

/**
 * Decide whether a single session row qualifies as zombie at `now`.
 * Pure function — no I/O. Used by both the reaper itself and the
 * unit tests.
 *
 * @param {{ id: string, status: string, updated_at?: string|null,
 *           created_at?: string|null }} session
 * @param {{ now: number, codingHours: number, pausedHours: number }} ctx
 * @returns {{ zombie: boolean, reason?: string }}
 */
export function classifyZombie(session, ctx) {
  if (!session || !session.status) return { zombie: false };
  const status = String(session.status).toLowerCase();
  // Reference timestamp: prefer updated_at (the daemon writes that on
  // every checkpoint sync), fall back to created_at (in case the row
  // was inserted but never touched again).
  const refIso = session.updated_at || session.created_at;
  if (!refIso) return { zombie: false };
  const refTs = new Date(refIso).getTime();
  if (Number.isNaN(refTs)) return { zombie: false };
  const ageHours = (ctx.now - refTs) / 3_600_000;
  if (ageHours <= 0) return { zombie: false };
  if (CODING_LIKE_STATUSES.has(status) && ageHours >= ctx.codingHours) {
    return { zombie: true, reason: `${status} ${ageHours.toFixed(1)}h inactive (>= ${ctx.codingHours}h)` };
  }
  if (PAUSED_STATUSES.has(status) && ageHours >= ctx.pausedHours) {
    return { zombie: true, reason: `${status} ${ageHours.toFixed(1)}h inactive (>= ${ctx.pausedHours}h)` };
  }
  return { zombie: false };
}

/**
 * Filter a list of session rows down to the zombie ones. Pure.
 *
 * @param {Array<object>} sessions
 * @param {{ now?: number, codingHours?: number, pausedHours?: number }} [opts]
 * @returns {Array<{ session: object, reason: string }>}
 */
export function findZombieSessions(sessions, opts = {}) {
  const ctx = {
    now: opts.now ?? Date.now(),
    codingHours: opts.codingHours ?? DEFAULT_CODING_HOURS,
    pausedHours: opts.pausedHours ?? DEFAULT_PAUSED_HOURS,
  };
  const out = [];
  for (const session of sessions || []) {
    const verdict = classifyZombie(session, ctx);
    if (verdict.zombie) out.push({ session, reason: verdict.reason });
  }
  return out;
}

/**
 * Append a `zombie-reap` checkpoint to a JSON-encoded checkpoints
 * blob (the on-disk format). Returns the new JSON string.
 *
 * Defensive about malformed input: if the existing blob isn't a
 * JSON array, replaces it with a fresh array containing the new
 * entry — never throws.
 */
export function appendZombieCheckpoint(existingJson, reason, isoTimestamp) {
  let arr = [];
  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      if (Array.isArray(parsed)) arr = parsed;
    } catch { /* fall through with empty arr */ }
  }
  arr.push({ stage: "zombie-reap", reason, at: isoTimestamp });
  return JSON.stringify(arr);
}

/**
 * Reap every zombie session in the DB. Side-effecting: updates
 * `status` and `checkpoints`. Returns the list of reaped sessions
 * so the server can log them.
 *
 * @param {object} deps
 * @param {object} deps.db        better-sqlite3 Database handle
 * @param {object} [deps.opts]    threshold overrides
 * @param {Function} [deps.now]   () => number, for tests
 * @returns {Array<{ id: string, status_before: string, reason: string }>}
 */
export function reapZombieSessions({ db, opts = {}, now = () => Date.now() }) {
  if (!db) return [];
  const allSessions = db.prepare(
    "SELECT id, status, updated_at, created_at, checkpoints FROM sessions WHERE status NOT IN ('failed', 'approved', 'cancelled', 'done')",
  ).all();
  const zombies = findZombieSessions(allSessions, { ...opts, now: now() });
  if (zombies.length === 0) return [];
  const update = db.prepare(
    "UPDATE sessions SET status = 'failed', checkpoints = ?, updated_at = ? WHERE id = ?",
  );
  const reapedAt = new Date(now()).toISOString();
  const reaped = [];
  for (const { session, reason } of zombies) {
    const newCheckpoints = appendZombieCheckpoint(session.checkpoints, reason, reapedAt);
    update.run(newCheckpoints, reapedAt, session.id);
    reaped.push({ id: session.id, status_before: session.status, reason });
  }
  return reaped;
}
