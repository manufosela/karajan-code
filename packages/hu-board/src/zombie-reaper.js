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
 * `kj board start` and saw the popup of an HU from 2026-04-27 — 9
 * days dead, status still `paused`. The fix per his explicit
 * mandate:
 *
 *   "No puede quedarse nada zombie. Debe haber algun sistema que lo
 *    compruebe al arrancar y mate esos zombies."
 *
 * Thresholds (per his decision in the same session):
 *   - status in (coding | stalled) and >= 6h since updated_at  → reap
 *   - status === paused and >= 24h since updated_at            → reap
 *   - everything else                                          → skip
 *
 * What "reap" means: write `status: "failed"` BOTH to the DB row
 * AND to the underlying `~/.karajan/sessions/<id>/session.json`,
 * append a structured checkpoint of the form
 *   { stage: 'zombie-reap', reason: <reason>, at: <iso> }
 * so the audit trail survives. The session row stays in place
 * (we don't DELETE — the user can still inspect what happened).
 *
 * Why update the JSON on disk too
 * -------------------------------
 *
 * The board's `fullScan()` reads every session.json on startup and
 * upserts the row, OVERWRITING any DB-only mutation. If the reaper
 * only updated the DB, the next reboot would reset the status back
 * to `paused`/`stalled` because the JSON still says so. Persisting
 * to disk makes the reap permanent on the first reboot — the user
 * sees the cleanup once, and never again.
 */

import fs from "node:fs";
import path from "node:path";

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
 * Default location of the on-disk session JSON files. Delegates to
 * db.js::getKjHome (KJC-TSK-0420): KARAJAN_HOME > KJ_HOME > VITEST > default.
 * @returns {string}
 */
import { getKjHome } from "./db.js";
function getSessionsDir() {
  return path.join(getKjHome(), "sessions");
}

/**
 * Persist `status: "failed"` and the new zombie-reap checkpoint to
 * the on-disk session.json. This stops the next `fullScan()` from
 * resurrecting the zombi.
 *
 * Safe-by-default: if the file is missing, malformed, or the write
 * fails, this returns `false` and the caller logs a warning. We
 * never throw and we never block the daemon's startup.
 *
 * @param {string} sessionId
 * @param {string} reason
 * @param {string} reapedAtIso
 * @param {{ sessionsDir?: string }} [opts]
 * @returns {boolean} true when the file was rewritten successfully
 */
export function markSessionFailedOnDisk(sessionId, reason, reapedAtIso, opts = {}) {
  const dir = opts.sessionsDir || getSessionsDir();
  const file = path.join(dir, sessionId, "session.json");
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return false; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return false; }
  if (!parsed || typeof parsed !== "object") return false;
  parsed.status = "failed";
  parsed.updated_at = reapedAtIso;
  parsed.checkpoints = Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [];
  parsed.checkpoints.push({ stage: "zombie-reap", reason, at: reapedAtIso });
  try {
    fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
    return true;
  } catch { return false; }
}

/**
 * Reap every zombie session in the DB AND in the underlying
 * session.json files. Side-effecting. Returns the list of reaped
 * sessions so the server can log them.
 *
 * @param {object} deps
 * @param {object} deps.db        better-sqlite3 Database handle
 * @param {object} [deps.opts]    threshold + sessionsDir overrides
 * @param {Function} [deps.now]   () => number, for tests
 * @returns {Array<{ id: string, status_before: string, reason: string, disk_persisted: boolean }>}
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
    const diskPersisted = markSessionFailedOnDisk(session.id, reason, reapedAt, {
      sessionsDir: opts.sessionsDir,
    });
    reaped.push({
      id: session.id,
      status_before: session.status,
      reason,
      disk_persisted: diskPersisted,
    });
  }
  return reaped;
}
