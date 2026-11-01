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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomicSync } from 'karajan-core/atomic-write';
import { updateHuStatus, certifyAllHus, updateHu } from 'karajan-core/plan-hu-ops';
import { validateBlockedByChange } from 'karajan-core/plan-validation';
import { syncPlanFile } from './sync.js';
import { getDb } from './db.js';

/**
 * Root directory where `kj plan` writes `<slug>/<planId>.json`. Honours
 * `KJ_PLANS_DIR` (tests) then `KJ_HOME/plans` (power users) then
 * `~/.kj/plans/` (default) — same precedence as `sync.js::fullScan`.
 */
// KJC-BUG-0059: write operations go to the canonical plans dir.
// Read operations should iterate getHuBoardPlansDirs() instead, to
// pick up plans the user has under the legacy ~/.kj/plans/ tree
// while the auto-migrator has not yet fired.
import { getHuBoardPlansDir } from './db.js';
function plansRoot() {
  return getHuBoardPlansDir();
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
function findPlanFilePath(planId, projectId) {
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

// KJC-TSK-1166 (ADR 0025): a plan that mirrors the shared board is a view. The truth is
// in the issues; the board shows it and refuses to edit it, so the two never diverge.
function mirrorGuard(plan) {
  if (!plan?.readonly) return null;
  return { ok: false, readonly: true, error: `this plan mirrors the shared board (${plan.readonly}) and is read-only here: change it with kj hu move` };
}

function writePlan(filePath, plan) {
  writeJsonAtomicSync(filePath, plan);
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
  const mirrored = mirrorGuard(plan);
  if (mirrored) return mirrored;
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
 * Edit one HU's user-facing fields in place. Whitelist mirrors
 * `updateHu` in plan-hu-ops so the CLI and the board stay in lock-step:
 * title, task_type, scope, acceptance_criteria, acceptance_tests,
 * blocked_by. Unknown keys are silently ignored.
 *
 * The caller passes a `patch` object with whichever subset of fields
 * the user actually changed — pushing the whole HU every time would
 * make optimistic concurrency harder to add later.
 *
 * @param {object} args
 * @param {string} args.planId
 * @param {string} args.huId
 * @param {object} args.patch
 * @param {string} [args.projectId]
 * @returns {{ ok: true, hu: object } | { ok: false, error: string }}
 */
export function setHuFields({ planId, huId, patch, projectId }) {
  const filePath = findPlanFilePath(planId, projectId);
  if (!filePath) return { ok: false, error: `plan not found: ${planId}` };

  const plan = readPlan(filePath);
  const mirrored = mirrorGuard(plan);
  if (mirrored) return mirrored;
  if (!Array.isArray(plan.hus)) return { ok: false, error: 'plan has no hus[]' };

  // KJC-TSK-0401: si el patch toca blocked_by, validar antes de
  // persistir. Rechazar refs huérfanas, auto-deps y ciclos.
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'blocked_by')) {
    const result = validateBlockedByChange(plan, huId, patch.blocked_by);
    if (!result.ok) {
      return { ok: false, error: result.error, code: 'INVALID_BLOCKED_BY', cycle: result.cycle };
    }
  }

  const updated = updateHu(plan, huId, patch || {});
  if (!updated) return { ok: false, error: `hu not found: ${huId}` };

  writePlan(filePath, plan);
  syncPlanFile(filePath);
  return { ok: true, hu: updated };
}

/**
 * KJC-TSK-0404: marcar una HU como fallida con blocker y timestamp
 * (sin tocar status). Usado por el zombie-reaper al detectar timeout
 * para que el siguiente `kj run` sepa el motivo del último fallo.
 *
 * @param {object} args
 * @param {string} args.planId
 * @param {string} args.huId
 * @param {string} args.blocker - razón del fallo
 * @param {string} [args.projectId]
 * @returns {{ ok: boolean, hu?: object, error?: string }}
 */
export function setHuFailResult({ planId, huId, blocker, projectId }) {
  const filePath = findPlanFilePath(planId, projectId);
  if (!filePath) return { ok: false, error: `plan not found: ${planId}` };
  const plan = readPlan(filePath);
  const mirrored = mirrorGuard(plan);
  if (mirrored) return mirrored;
  if (!Array.isArray(plan.hus)) return { ok: false, error: 'plan has no hus[]' };
  const hu = plan.hus.find(h => h.id === huId);
  if (!hu) return { ok: false, error: `hu not found: ${huId}` };

  hu.result = 'fail';
  hu.updatedAt = new Date().toISOString();
  const existing = (hu.outcome && Array.isArray(hu.outcome.blockers)) ? hu.outcome.blockers : [];
  hu.outcome = {
    ...(hu.outcome || {}),
    blockers: blocker ? [...existing, blocker] : existing,
    failedAt: new Date().toISOString(),
  };
  writePlan(filePath, plan);
  syncPlanFile(filePath);
  return { ok: true, hu };
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
/**
 * PR-G: rename a project from the board.
 *
 * "Project" on the board is just a row in the projects table that
 * groups stories. The source of truth for the human-readable name
 * is `plan.name` inside each plan JSON for that project (PR-B made
 * sync.js prefer it over the cwd basename). So a rename has to:
 *
 *   1. Update plan.name on every plan JSON belonging to this project,
 *      so the next sync doesn't clobber the rename back to the
 *      basename derivation.
 *   2. Update the projects.name column directly so the UI updates
 *      without waiting for a full re-scan.
 *
 * Validates name length (1–120) and rejects empty/whitespace-only.
 *
 * @returns {{ ok: true, name, plansUpdated } | { ok: false, error }}
 */
export function renameProject({ projectId, name }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: false, error: 'El nombre no puede estar vacío.' };
  if (trimmed.length > 120) return { ok: false, error: 'El nombre no puede superar los 120 caracteres.' };

  const root = plansRoot();
  let plansUpdated = 0;
  if (existsSync(root)) {
    const projDir = join(root, projectId);
    if (existsSync(projDir)) {
      let files;
      try { files = readdirSync(projDir); } catch { files = []; }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const filePath = join(projDir, f);
        try {
          const plan = readPlan(filePath);
          // A mirror of the shared board keeps its own name; the rename goes on with the rest.
          if (plan.readonly) continue;
          plan.name = trimmed;
          plan.updatedAt = new Date().toISOString();
          writePlan(filePath, plan);
          plansUpdated += 1;
        } catch { /* skip unreadable plan */ }
      }
    }
  }

  // Update the project row directly so the UI reflects the new name
  // without waiting for the chokidar watcher to fire on the plan
  // edits above.
  try {
    const stmt = getDb().prepare('UPDATE projects SET name = ? WHERE id = ?');
    const res = stmt.run(trimmed, projectId);
    if (res.changes === 0 && plansUpdated === 0) {
      return { ok: false, error: `Proyecto no encontrado: ${projectId}` };
    }
  } catch (err) {
    return { ok: false, error: `Error actualizando la base de datos: ${err.message}` };
  }
  return { ok: true, name: trimmed, plansUpdated };
}

export function markPlanReady({ planId, projectId }) {
  const filePath = findPlanFilePath(planId, projectId);
  if (!filePath) return { ok: false, error: `plan not found: ${planId}` };

  const plan = readPlan(filePath);
  const mirrored = mirrorGuard(plan);
  if (mirrored) return mirrored;
  if (!Array.isArray(plan.hus) || plan.hus.length === 0) {
    return { ok: false, error: 'plan has no hus[]' };
  }

  const count = certifyAllHus(plan);
  writePlan(filePath, plan);
  syncPlanFile(filePath);
  return { ok: true, count, planStatus: plan.status };
}
