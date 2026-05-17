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

/**
 * Per-plan classifier. Pulled out so the surrounding GC can evaluate
 * candidates in parallel — every plan is independent (no shared state
 * across iterations except the result accumulator, which is folded back
 * after the bursts settle).
 */
async function classifyPlan(filePath, opts, now) {
  const stat = await tryStat(filePath);
  if (!stat) return { skip: true };
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
  return { skip: false, stat, reason };
}

async function gcPlans(opts) {
  const result = { removed: [], bytesFreed: 0, errors: [] };
  const now = opts.now || new Date();
  const plansRoot = path.join(getKjHome(), "plans");
  if (!(await exists(plansRoot))) return result;

  // Audit follow-up: was nested sequential for-of with multiple awaits per
  // iteration. Plans are independent files so we now classify them in
  // parallel per project directory. Each project dir's bursts complete
  // before we move to the next so the order of `result.removed` stays
  // deterministic for tests; cross-project parallelism wasn't worth the
  // complexity given KJ_HOME rarely has more than a handful of projects.
  const projEntries = (await listDir(plansRoot)).filter((e) => e.isDirectory());
  for (const projEntry of projEntries) {
    const projDir = path.join(plansRoot, projEntry.name);
    const planEntries = (await listDir(projDir))
      .filter((e) => e.isFile() && e.name.endsWith(".json"));

    const verdicts = await Promise.all(
      planEntries.map(async (planEntry) => {
        const filePath = path.join(projDir, planEntry.name);
        const verdict = await classifyPlan(filePath, opts, now);
        return { filePath, verdict };
      })
    );

    let removedCountInDir = 0;
    const totalCountInDir = planEntries.length;
    for (const { filePath, verdict } of verdicts) {
      if (verdict.skip || !verdict.reason) continue;
      try {
        await unlinkOrRm(filePath, opts.dryRun);
        result.removed.push({ path: filePath, reason: verdict.reason, kind: "plan", bytes: verdict.stat.size });
        result.bytesFreed += verdict.stat.size;
        removedCountInDir += 1;
      } catch (err) {
        result.errors.push({ path: filePath, error: err.message });
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

  // Audit follow-up: parallelise the per-session classification (read
  // session.json + stat the dir). Deletion stays sequential so the
  // result.removed order is deterministic for tests.
  const sessEntries = (await listDir(sessionsRoot)).filter((e) => e.isDirectory());
  const verdicts = await Promise.all(
    sessEntries.map(async (sessEntry) => {
      const sessDir = path.join(sessionsRoot, sessEntry.name);
      const sessionFile = path.join(sessDir, "session.json");
      const stat = await tryStat(sessDir);
      if (!stat) return { sessDir, reason: null };
      const data = await tryReadJson(sessionFile);
      const status = data?.status;
      const days = ageInDays(stat, now);

      let reason = null;
      if (status && FINAL_SESSION_STATUSES.has(status) && days > opts.sessionRetentionDays) {
        reason = `${status} session older than ${opts.sessionRetentionDays}d (${Math.round(days)}d)`;
      } else if ((!status || status === "running") && days > staleRunningDays) {
        reason = `zombie ${status || "unknown-status"} session older than ${staleRunningDays}d (${Math.round(days)}d)`;
      }
      return { sessDir, reason };
    })
  );

  for (const { sessDir, reason } of verdicts) {
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

  // Audit follow-up: stat-then-classify in parallel; deletion stays
  // sequential for deterministic ordering.
  const batchEntries = (await listDir(huRoot)).filter((e) => e.isDirectory());
  const verdicts = await Promise.all(
    batchEntries.map(async (batchEntry) => {
      const batchDir = path.join(huRoot, batchEntry.name);
      const stat = await tryStat(batchDir);
      if (!stat) return null;
      const days = ageInDays(stat, now);
      if (days <= opts.huRetentionDays) return null;
      return {
        batchDir,
        reason: `HU batch older than ${opts.huRetentionDays}d (${Math.round(days)}d)`,
      };
    })
  );

  for (const v of verdicts) {
    if (!v) continue;
    try {
      await unlinkOrRm(v.batchDir, opts.dryRun);
      result.removed.push({ path: v.batchDir, reason: v.reason, kind: "hu-batch" });
    } catch (err) {
      result.errors.push({ path: v.batchDir, error: err.message });
    }
  }
  return result;
}

// KJC-TSK-0414 PR3: limpia ~/.kj/standby/done/<id>-<ts>.json finalizadas
// hace > N días. Las pendientes en ~/.kj/standby/<id>.json NUNCA se tocan
// — son las que esperan resume.
async function gcStandbyDone(opts) {
  const result = { removed: [], bytesFreed: 0, errors: [] };
  const now = opts.now || new Date();
  const doneDir = path.join(getKjHome(), "standby", "done");
  if (!(await exists(doneDir))) return result;

  const entries = (await listDir(doneDir)).filter((e) => e.isFile());
  for (const entry of entries) {
    const file = path.join(doneDir, entry.name);
    const stat = await tryStat(file);
    if (!stat) continue;
    const days = ageInDays(stat, now);
    if (days <= opts.standbyDoneRetentionDays) continue;
    try {
      await unlinkOrRm(file, opts.dryRun);
      result.removed.push({ path: file, reason: `standby done > ${opts.standbyDoneRetentionDays}d (${Math.round(days)}d)`, kind: "standby-done" });
    } catch (err) {
      result.errors.push({ path: file, error: err.message });
    }
  }
  return result;
}

// KJC-TSK-0414 PR3: limpia ~/.karajan/audits/<project>/ con last mtime > N días.
// El usuario reportó decenas de carpetas kj-test-* huérfanas — son audits de
// runs antiguos cuyo project ya no existe o que llevan meses sin actividad.
async function gcAudits(opts) {
  const result = { removed: [], bytesFreed: 0, errors: [] };
  const now = opts.now || new Date();
  const auditRoot = path.join(getKarajanHome(), "audits");
  if (!(await exists(auditRoot))) return result;

  const entries = (await listDir(auditRoot)).filter((e) => e.isDirectory());
  for (const entry of entries) {
    const dir = path.join(auditRoot, entry.name);
    const stat = await tryStat(dir);
    if (!stat) continue;
    const days = ageInDays(stat, now);
    if (days <= opts.auditsRetentionDays) continue;
    try {
      await unlinkOrRm(dir, opts.dryRun);
      result.removed.push({ path: dir, reason: `audit > ${opts.auditsRetentionDays}d sin actividad (${Math.round(days)}d)`, kind: "audit" });
    } catch (err) {
      result.errors.push({ path: dir, error: err.message });
    }
  }
  return result;
}

// KJC-TSK-0414 PR3: ~/.karajan/hu-board-runs/<runId>/ con mtime > N días.
async function gcHuBoardRuns(opts) {
  const result = { removed: [], bytesFreed: 0, errors: [] };
  const now = opts.now || new Date();
  const root = path.join(getKarajanHome(), "hu-board-runs");
  if (!(await exists(root))) return result;

  const entries = (await listDir(root)).filter((e) => e.isDirectory());
  for (const entry of entries) {
    const dir = path.join(root, entry.name);
    const stat = await tryStat(dir);
    if (!stat) continue;
    const days = ageInDays(stat, now);
    if (days <= opts.huBoardRunsRetentionDays) continue;
    try {
      await unlinkOrRm(dir, opts.dryRun);
      result.removed.push({ path: dir, reason: `hu-board-run > ${opts.huBoardRunsRetentionDays}d (${Math.round(days)}d)`, kind: "hu-board-run" });
    } catch (err) {
      result.errors.push({ path: dir, error: err.message });
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
    // KJC-TSK-0414 PR3
    standbyDoneRetentionDays: opts.standbyDoneRetentionDays ?? 7,
    auditsRetentionDays: opts.auditsRetentionDays ?? 30,
    huBoardRunsRetentionDays: opts.huBoardRunsRetentionDays ?? 30,
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
  // Audit follow-up: was 3 sequential awaits. Plans, sessions and HU
  // stories live in different directory subtrees and don't share state,
  // so Promise.all is safe and roughly halves end-to-end GC latency on
  // a populated KJ_HOME.
  const [plans, sessions, huStories, standbyDone, audits, huBoardRuns] = await Promise.all([
    gcPlans(o),
    gcSessions(o),
    gcHuStories(o),
    gcStandbyDone(o),
    gcAudits(o),
    gcHuBoardRuns(o),
  ]);
  return mergeResults(plans, sessions, huStories, standbyDone, audits, huBoardRuns);
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

  // Stop the board if we find a live pidfile — UNLESS we're being
  // invoked from inside the board itself (the user clicked ⚡ →
  // `kj clean --nuke` in the launcher). In that case killing the
  // board would kill the page they're looking at, mid-confirm.
  // command-runner.js sets KJ_INSIDE_BOARD=1 on every spawn so we
  // can detect this. The nuke still wipes the DB; the board picks
  // up the empty DB on its next chokidar tick.
  const insideBoard = process.env.KJ_INSIDE_BOARD === "1";
  const pidFile = path.join(kHome, "hu-board.pid");
  try {
    const pid = Number.parseInt(await fs.readFile(pidFile, "utf8"), 10);
    if (!dryRun && Number.isFinite(pid) && !insideBoard) {
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
