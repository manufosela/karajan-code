/**
 * Server-side mutations for plan HUs triggered from the board UI.
 *
 * The source of truth is the plan JSON at `~/.kj/plans/<slug>/<planId>.json`.
 * Every mutation in this module follows the same protocol:
 *
 *   1. Load the plan JSON from disk.
 *   2. Mutate it in-memory using the helpers from `src/plan/plan-hu-ops.js`
 *      (so CLI `kj plan ready` and board "Mark ready" stay in lock-step).
 *   3. Write the JSON back.
 *   4. Re-sync the plan into SQLite via `syncPlanFile` so the board
 *      reflects the change on the next render without a manual refresh.
 *
 * Steps 2-4 must share a single on-disk write: we never ack the mutation to
 * the UI without persisting it, otherwise a reload would silently revert.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { updateHuStatus, certifyAllHus } from '../../../src/plan/plan-hu-ops.js';
import { syncPlanFile } from './sync.js';

// Repo root → so we can spawn `node <repo>/src/cli.js run ...` without
// depending on `kj` being in $PATH of the board process.
const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url));       // packages/hu-board/src
  return join(here, '..', '..', '..');                         // → repo root
})();
const KJ_CLI = join(REPO_ROOT, 'src', 'cli.js');

/**
 * Root directory where `kj plan` writes `<slug>/<planId>.json`. Honours
 * `KJ_PLANS_DIR` (tests) then `KJ_HOME/plans` (power users) then
 * `~/.kj/plans/` (default) — same precedence as `sync.js::fullScan`.
 */
function plansRoot() {
  if (process.env.KJ_PLANS_DIR) return process.env.KJ_PLANS_DIR;
  if (process.env.KJ_HOME) return join(process.env.KJ_HOME, 'plans');
  return join(homedir(), '.kj', 'plans');
}

/**
 * Locate `<planId>.json` on disk. If `projectId` is known we go straight
 * to that subdir; otherwise we fall back to scanning every project dir
 * (costly, only used when the HU row pre-dates the `plan_id` migration
 * and we have nothing else to go on).
 *
 * @param {string} planId
 * @param {string|undefined} projectId
 * @returns {string|null}
 */
export function findPlanFilePath(planId, projectId) {
  const root = plansRoot();
  if (!existsSync(root)) return null;
  const fileName = `${planId}.json`;
  if (projectId) {
    const direct = join(root, projectId, fileName);
    if (existsSync(direct)) return direct;
  }
  // Fall back to a scan so legacy rows without plan_id still work.
  let dirs;
  try { dirs = readdirSync(root); } catch { return null; }
  for (const d of dirs) {
    const candidate = join(root, d, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Load + validate a plan file in one step. Callers pass the on-disk path
 * returned by `findPlanFilePath`.
 * @param {string} filePath
 */
function readPlan(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function writePlan(filePath, plan) {
  writeFileSync(filePath, JSON.stringify(plan, null, 2), 'utf-8');
}

/**
 * Change a single HU's status inside its plan JSON and re-sync into
 * SQLite. Returns the new status, so callers can 200-reply with the
 * committed value (not a shadow copy that might differ from disk).
 *
 * Valid statuses mirror the CLI: pending, certified, done. Anything else
 * is rejected up the stack — we don't silently coerce.
 *
 * @param {object} args
 * @param {string} args.planId
 * @param {string} args.huId
 * @param {string} args.status - new status
 * @param {string} [args.projectId] - optional hint to avoid the scan
 * @returns {{ ok: true, status: string, planStatus: string } | { ok: false, error: string }}
 */
export function setHuStatus({ planId, huId, status, projectId }) {
  const filePath = findPlanFilePath(planId, projectId);
  if (!filePath) return { ok: false, error: `plan not found: ${planId}` };

  const plan = readPlan(filePath);
  if (!Array.isArray(plan.hus)) return { ok: false, error: 'plan has no hus[]' };

  const existed = updateHuStatus(plan, huId, status);
  if (!existed) return { ok: false, error: `hu not found: ${huId}` };

  // When every remaining HU is certified, auto-advance the plan status
  // to "ready" so the CLI hint `kj run --plan <id>` matches reality.
  // Conversely, downgrading the last certified HU back to pending must
  // roll the plan back to "draft" — otherwise `kj run` would refuse to
  // reload a supposedly-ready plan whose HUs disagree.
  if (plan.hus.every((h) => h.status === 'certified' || h.status === 'done')) {
    plan.status = 'ready';
  } else if (plan.hus.some((h) => h.status === 'pending')) {
    plan.status = 'draft';
  }

  writePlan(filePath, plan);
  syncPlanFile(filePath);
  return { ok: true, status, planStatus: plan.status };
}

/**
 * Bulk certify: equivalent to `kj plan ready <planId>` over HTTP. Flips
 * every pending HU to certified and sets `plan.status = "ready"`. No-op
 * on already-ready plans (idempotent, returns count=0).
 *
 * @param {object} args
 * @param {string} args.planId
 * @param {string} [args.projectId]
 * @returns {{ ok: true, count: number, planStatus: string } | { ok: false, error: string }}
 */
export function markPlanReady({ planId, projectId }) {
  const filePath = findPlanFilePath(planId, projectId);
  if (!filePath) return { ok: false, error: `plan not found: ${planId}` };

  const plan = readPlan(filePath);
  if (!Array.isArray(plan.hus) || plan.hus.length === 0) {
    return { ok: false, error: 'plan has no hus[]' };
  }

  const count = certifyAllHus(plan);
  writePlan(filePath, plan);
  syncPlanFile(filePath);
  return { ok: true, count, planStatus: plan.status };
}

/**
 * Launch `kj run --plan <planId>` as a detached child. This is the
 * "Run plan" button's server-side handler: the board no longer asks the
 * user to drop to the terminal to kick off execution.
 *
 * We spawn against the repo's own CLI (`node <repo>/src/cli.js`) instead
 * of a `kj` binary on $PATH — the board is always shipped with the repo
 * that hosts it, so that entry point is guaranteed to exist. Tests set
 * `KJ_RUN_SPAWN_MODE=echo` to replace the spawn with a no-op that just
 * returns a fake pid, so we can assert payload shape without booting the
 * whole orchestrator inside vitest.
 *
 * Output is redirected to `~/.karajan/hu-board-runs/<planId>.log` so the
 * board can tail it later if we wire up a live log viewer — for now it's
 * just a durable trail. stdin is `ignore` (coder subprocess requirement
 * documented in CLAUDE.md).
 *
 * @param {object} args
 * @param {string} args.planId
 * @param {string} [args.projectId]
 * @param {string} [args.taskOverride] - optional custom task string
 * @returns {{ ok: true, pid: number, logPath: string } | { ok: false, error: string }}
 */
export function runPlan({ planId, projectId, taskOverride } = {}) {
  const filePath = findPlanFilePath(planId, projectId);
  if (!filePath) return { ok: false, error: `plan not found: ${planId}` };

  const plan = readPlan(filePath);
  if (!Array.isArray(plan.hus) || plan.hus.length === 0) {
    return { ok: false, error: 'plan has no hus[]' };
  }
  const projectDir = plan.projectDir;
  if (!projectDir) {
    return {
      ok: false,
      error:
        'plan has no projectDir stamped — re-run `kj plan` to regenerate it, '
        + 'then try again (plans pre-v2.7.4 did not persist the dir).',
    };
  }

  const runsDir = join(process.env.KJ_HOME || join(homedir(), '.karajan'), 'hu-board-runs');
  mkdirSync(runsDir, { recursive: true });
  const logPath = join(runsDir, `${planId}.log`);

  const task = taskOverride || plan.task || `run plan ${planId}`;
  const args = [KJ_CLI, 'run', '--plan', planId, task];

  // Escape hatch for tests — hard-kill the spawn so vitest doesn't boot
  // the full orchestrator. The shape of the response is what we assert.
  if (process.env.KJ_RUN_SPAWN_MODE === 'echo') {
    return { ok: true, pid: 0, logPath, argv: [process.execPath, ...args], projectDir };
  }

  const out = openSync(logPath, 'a');
  const err = openSync(logPath, 'a');
  const child = spawn(process.execPath, args, {
    cwd: projectDir,
    detached: true,
    stdio: ['ignore', out, err],
    // Strip CLAUDECODE so the Claude agent subprocess trick in
    // claude-agent.js doesn't misbehave (documented in CLAUDE.md).
    env: { ...process.env, CLAUDECODE: undefined },
  });
  child.unref();
  return { ok: true, pid: child.pid ?? 0, logPath };
}
