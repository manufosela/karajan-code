/**
 * Karajan garbage collector — keeps `~/.kj/` and `~/.karajan/` from
 * accumulating dead state across runs.
 *
 * Dogfood motivation: after ~1 year the user's `~/.kj/plans/` had 2 464
 * plans in `home_manu_ws_npm-packages_karajan-code/` plus 35 plans from
 * worktrees that no longer exist. Same story for `~/.karajan/sessions/`
 * and `hu-stories/`. None ever got cleaned because no command did it.
 */

/**
 * Two entry points:
 *   - `runAutoGC(opts)` — silent, called at the top of every `kj run`
 *     and `kj plan`. Prints a single one-liner ONLY when something was
 *     removed.
 *   - `runManualGC(opts)` — backs `kj clean`. Caller decides `dryRun`;
 *     returns the full `{ removed, bytesFreed, errors }` record.
 *
 * Retention policy (all adjustable via opts):
 *   • Plans whose stamped `projectDir` no longer exists → delete.
 *   • Plans with final status (approved/rejected/executed) older than
 *     `planRetentionDays` (30) → delete.
 *   • Draft plans older than `draftRetentionDays` (60) → delete.
 *   • Finalised sessions older than `sessionRetentionDays` (7) → delete.
 *   • HU story batches older than `huRetentionDays` (14) → delete.
 *
 * Failures are NEVER fatal — every op is try/catch and non-blocking.
 * Tested against an isolated tmp KJ_HOME so production data is safe.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const FINAL_PLAN_STATUSES = new Set([
  // Terminal plan states the user explicitly opted into — retention applies.
  "approved", "rejected", "executed", "completed", "ready",
]);
const KNOWN_PLAN_STATUSES = new Set([...FINAL_PLAN_STATUSES, "draft", "running"]);
const FINAL_SESSION_STATUSES = new Set(["approved", "failed", "stopped", "rejected", "completed"]);

function getKjHome() {
  return process.env.KJ_HOME || path.join(os.homedir(), ".kj");
}

function getKarajanHome() {
  return process.env.KARAJAN_HOME || path.join(os.homedir(), ".karajan");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} GCOptions
 * @property {number} [planRetentionDays=30]
 * @property {number} [draftRetentionDays=60]
 * @property {number} [sessionRetentionDays=7]
 * @property {number} [huRetentionDays=14]
 * @property {boolean} [dryRun=false]   - only report what would be removed
 * @property {Date}    [now]            - clock injection for tests
 */

/**
 * @typedef {Object} GCResult
 * @property {Array<{path: string, reason: string, kind: string, bytes?: number}>} removed
 * @property {number} bytesFreed
 * @property {Array<{path: string, error: string}>} errors
 */

async function tryReadJson(file) {
  try {
    const txt = await fs.readFile(file, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function tryStat(p) {
  try { return await fs.stat(p); } catch { return null; }
}

async function exists(p) {
  return Boolean(await tryStat(p));
}

async function listDir(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
}

async function unlinkOrRm(p, dryRun) {
  if (dryRun) return;
  try {
    const st = await fs.stat(p);
    if (st.isDirectory()) await fs.rm(p, { recursive: true, force: true });
    else await fs.unlink(p);
  } catch { /* best-effort */ }
}

function ageInDays(stat, now) {
  return (now.getTime() - stat.mtimeMs) / DAY_MS;
}

// Slugs are lossy — we CAN'T recover a path from one because `_` in
// the slug could have come from either `/` in the path or a literal
// `_` in a directory name (e.g. `ws_ai` vs `ws/ai`). That's why plans
// saved via `savePlan()` now stamp their absolute `projectDir`; the GC
// reads it from there. Legacy plans without the field fall back to
// age-only retention — never marked as orphans on the way up.

async function gcPlans(opts) {
  const result = { removed: [], bytesFreed: 0, errors: [] };
  const now = opts.now || new Date();
  const plansRoot = path.join(getKjHome(), "plans");
  if (!(await exists(plansRoot))) return result;

  for (const projEntry of await listDir(plansRoot)) {
    if (!projEntry.isDirectory()) continue;
    const projDir = path.join(plansRoot, projEntry.name);

    let removedCountInDir = 0;
    let totalCountInDir = 0;

    for (const planEntry of await listDir(projDir)) {
      if (!planEntry.isFile() || !planEntry.name.endsWith(".json")) continue;
      totalCountInDir += 1;
      const filePath = path.join(projDir, planEntry.name);
      const stat = await tryStat(filePath);
      if (!stat) continue;

      const data = await tryReadJson(filePath);
      const status = data?.status || "draft";
      const storedDir = typeof data?.projectDir === "string" ? data.projectDir : null;
      const days = ageInDays(stat, now);

      let reason = null;
      // Orphan check: only when the plan stamped its origin projectDir.
      // Plans older than the savePlan-stamping change don't have it, so
      // we refuse to guess and just apply age-based retention.
      if (storedDir && !(await exists(storedDir))) {
        reason = "orphaned (project dir no longer exists)";
      } else if (FINAL_PLAN_STATUSES.has(status) && days > opts.planRetentionDays) {
        reason = `${status} plan older than ${opts.planRetentionDays}d (${Math.round(days)}d)`;
      } else if (status === "draft" && days > opts.draftRetentionDays) {
        reason = `stale draft older than ${opts.draftRetentionDays}d (${Math.round(days)}d)`;
      } else if (!KNOWN_PLAN_STATUSES.has(status) && days > opts.draftRetentionDays) {
        // Unknown status (corrupt/legacy/plan from a future version) —
        // apply the draft window. Doing nothing would leak them forever.
        reason = `plan with unknown status "${status}" older than ${opts.draftRetentionDays}d (${Math.round(days)}d)`;
      }

      if (reason) {
        try {
          await unlinkOrRm(filePath, opts.dryRun);
          result.removed.push({ path: filePath, reason, kind: "plan", bytes: stat.size });
          result.bytesFreed += stat.size;
          removedCountInDir += 1;
        } catch (err) {
          result.errors.push({ path: filePath, error: err.message });
        }
      }
    }

    // If we just emptied the project dir, remove it too.
    if (removedCountInDir === totalCountInDir && totalCountInDir > 0) {
      try {
        await unlinkOrRm(projDir, opts.dryRun);
      } catch { /* ignore */ }
    }
  }
  return result;
}

async function gcSessions(opts) {
  const result = { removed: [], bytesFreed: 0, errors: [] };
  const now = opts.now || new Date();
  const sessionsRoot = path.join(getKarajanHome(), "sessions");
  if (!(await exists(sessionsRoot))) return result;

  // Pipelines that get SIGKILL'd (power off, terminal closed, OOM…) leave
  // their session.json stuck at status="running" forever. The original GC
  // only reclaimed FINAL statuses and these zombies accumulated on the
  // board. After `staleRunningDays` with no activity we assume the run is
  // dead and sweep them. Default mirrors sessionRetentionDays so there is
  // only one knob to reason about.
  const staleRunningDays = opts.staleRunningDays ?? opts.sessionRetentionDays;

  for (const sessEntry of await listDir(sessionsRoot)) {
    if (!sessEntry.isDirectory()) continue;
    const sessDir = path.join(sessionsRoot, sessEntry.name);
    const sessionFile = path.join(sessDir, "session.json");
    const stat = await tryStat(sessDir);
    if (!stat) continue;

    const data = await tryReadJson(sessionFile);
    const status = data?.status;
    const days = ageInDays(stat, now);

    let reason = null;
    if (status && FINAL_SESSION_STATUSES.has(status) && days > opts.sessionRetentionDays) {
      reason = `${status} session older than ${opts.sessionRetentionDays}d (${Math.round(days)}d)`;
    } else if ((!status || status === "running") && days > staleRunningDays) {
      reason = `zombie ${status || "unknown-status"} session older than ${staleRunningDays}d (${Math.round(days)}d)`;
    }

    if (!reason) continue;

    try {
      await unlinkOrRm(sessDir, opts.dryRun);
      result.removed.push({ path: sessDir, reason, kind: "session" });
    } catch (err) {
      result.errors.push({ path: sessDir, error: err.message });
    }
  }
  return result;
}

async function gcHuStories(opts) {
  const result = { removed: [], bytesFreed: 0, errors: [] };
  const now = opts.now || new Date();
  const huRoot = path.join(getKarajanHome(), "hu-stories");
  if (!(await exists(huRoot))) return result;

  for (const batchEntry of await listDir(huRoot)) {
    if (!batchEntry.isDirectory()) continue;
    const batchDir = path.join(huRoot, batchEntry.name);
    const stat = await tryStat(batchDir);
    if (!stat) continue;

    const days = ageInDays(stat, now);
    if (days <= opts.huRetentionDays) continue;

    try {
      await unlinkOrRm(batchDir, opts.dryRun);
      result.removed.push({
        path: batchDir,
        reason: `HU batch older than ${opts.huRetentionDays}d (${Math.round(days)}d)`,
        kind: "hu-batch",
      });
    } catch (err) {
      result.errors.push({ path: batchDir, error: err.message });
    }
  }
  return result;
}

function mergeResults(...parts) {
  const out = { removed: [], bytesFreed: 0, errors: [] };
  for (const r of parts) {
    out.removed.push(...r.removed);
    out.bytesFreed += r.bytesFreed;
    out.errors.push(...r.errors);
  }
  return out;
}

function defaultOpts(opts = {}) {
  return {
    planRetentionDays: opts.planRetentionDays ?? 30,
    draftRetentionDays: opts.draftRetentionDays ?? 60,
    sessionRetentionDays: opts.sessionRetentionDays ?? 7,
    huRetentionDays: opts.huRetentionDays ?? 14,
    dryRun: Boolean(opts.dryRun),
    now: opts.now || new Date(),
  };
}

/**
 * Manual GC — backs `kj clean`. Caller decides dryRun via opts.
 *
 * @param {GCOptions} [opts]
 * @returns {Promise<GCResult>}
 */
export async function runManualGC(opts = {}) {
  const o = defaultOpts(opts);
  return mergeResults(
    await gcPlans(o),
    await gcSessions(o),
    await gcHuStories(o),
  );
}

/**
 * Auto GC — silent, called at the top of `kj run` / `kj plan`. Always
 * destructive (dryRun ignored). Returns the same result so the caller
 * can print a one-liner summary if anything was removed.
 *
 * @param {Omit<GCOptions, 'dryRun'>} [opts]
 * @returns {Promise<GCResult>}
 */
export async function runAutoGC(opts = {}) {
  return runManualGC({ ...opts, dryRun: false });
}

/**
 * Wipe the HU board SQLite database (+WAL + SHM + pidfile). Used by
 * `kj clean --nuke` as the "reset everything" button.
 *
 * When the caller also stops the board process (we do so best-effort
 * here via the pidfile), re-starting the board with `kj board start`
 * or via the post-`kj plan` autostart recreates the DB empty.
 *
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<GCResult>}
 */
export async function nukeBoardDb(opts = {}) {
  const result = { removed: [], bytesFreed: 0, errors: [] };
  const dryRun = Boolean(opts.dryRun);
  const kHome = getKarajanHome();

  // Stop the board if we find a live pidfile.
  const pidFile = path.join(kHome, "hu-board.pid");
  try {
    const pid = Number.parseInt(await fs.readFile(pidFile, "utf8"), 10);
    if (!dryRun && Number.isFinite(pid)) {
      try { process.kill(pid, 0); process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
    }
  } catch { /* no pidfile */ }

  // The DB (+ WAL / SHM) can be hundreds of MB on old installs; report
  // the bytes freed so the user sees the reward.
  for (const name of ["hu-board.db", "hu-board.db-wal", "hu-board.db-shm", "hu-board.pid"]) {
    const p = path.join(kHome, name);
    const stat = await tryStat(p);
    if (!stat) continue;
    try {
      await unlinkOrRm(p, dryRun);
      result.removed.push({ path: p, reason: "board db wiped (--nuke)", kind: "board", bytes: stat.size });
      result.bytesFreed += stat.size;
    } catch (err) {
      result.errors.push({ path: p, error: err.message });
    }
  }
  return result;
}

/**
 * Format a GC result as a single human-readable line. Used by the
 * silent auto-GC path so the user only sees one line in the rare case
 * something was actually cleaned.
 *
 * @param {GCResult} result
 * @returns {string|null}    null when nothing was removed
 */
export function summarizeGC(result) {
  if (!result.removed.length) return null;
  const byKind = {};
  for (const r of result.removed) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  }
  const parts = Object.entries(byKind).map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`);
  const kb = Math.round(result.bytesFreed / 1024);
  return `[gc] removed ${parts.join(", ")}${kb ? ` (${kb} KiB)` : ""}`;
}
