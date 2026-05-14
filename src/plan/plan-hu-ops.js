/**
 * HU CRUD operations on a v2 plan.
 * All functions mutate the plan in-place and return it.
 */

import { generateHuId } from "./plan-id.js";

/**
 * Get the next sequential HU number for this plan.
 */
function nextSeq(plan) {
  if (!plan.hus || plan.hus.length === 0) return 1;
  const nums = plan.hus
    .map(h => {
      const m = h.id.match(/_(\d+)$/);
      return m ? Number(m[1]) : 0;
    })
    .filter(n => n > 0);
  return nums.length > 0 ? Math.max(...nums) + 1 : plan.hus.length + 1;
}

/**
 * Add an HU to the plan. Auto-generates a globally unique ID.
 * @param {object} plan - v2 plan
 * @param {object} huData - { title, task_type?, scope?, acceptance_criteria?, acceptance_tests?, blocked_by?, reuse? }
 * @returns {object} the created HU (with id assigned)
 */
export function addHu(plan, huData) {
  const seq = nextSeq(plan);
  const id = generateHuId(plan.planId, seq);
  const hu = {
    id,
    title: huData.title,
    task_type: huData.task_type || "sw",
    status: "pending",
    // KJC-TSK-0394: result ortogonal al status (último resultado conocido
    // de la ejecución; null = nunca ejecutada). Se actualiza cuando el
    // pipeline termina con pass / fail / partial. Nombre `result` (no
    // `outcome`) porque `outcome` ya está en uso como blob JSON con
    // iterations/duration/commits del run.
    result: huData.result ?? null,
    // Humanización IDs: short_id es el id legible que el planner asignó
    // al step (ej "INFRA-001", "AUTH-SIGNUP"). El `id` largo
    // (`hu_<planId>_<NNN>`) sigue siendo la clave canónica, pero el
    // CLI / board prefieren short_id para mostrar y aceptarlo como
    // referencia en `--hu`. Null cuando el planner no lo emitió.
    short_id: huData.short_id || null,
    blocked_by: huData.blocked_by || [],
    // KJC-BUG-0044 / P3: ids of OTHER HUs whose implementation this HU
    // piggy-backs on instead of reimplementing the same logic. Set by
    // the planner; consumed by the coder prompt + plan-reviewer to
    // avoid duplicate code generation.
    reuse: huData.reuse || [],
    scope: huData.scope || null,
    acceptance_criteria: huData.acceptance_criteria || [],
    acceptance_tests: huData.acceptance_tests || [],
    // Spec mapping (v2.7.5 PR C): the SPEC.md section / heading this
    // HU implements. Lets the coder cite "this implements SPEC §5.3"
    // in PRs and the reviewer trace coverage gaps when the SPEC is
    // re-read. Free-form string — typically "5.3", "§5.3 Initial
    // Scope", or whatever the planner extracted from the source spec.
    spec_section: huData.spec_section || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  plan.hus.push(hu);
  plan.updatedAt = new Date().toISOString();
  return hu;
}

/**
 * Remove an HU from the plan. Also cleans blocked_by references.
 * @returns {boolean} true if removed
 */
export function removeHu(plan, huId) {
  const idx = plan.hus.findIndex(h => h.id === huId);
  if (idx === -1) return false;
  plan.hus.splice(idx, 1);
  // Clean up blocked_by + reuse refs
  for (const hu of plan.hus) {
    hu.blocked_by = (hu.blocked_by || []).filter(dep => dep !== huId);
    hu.reuse = (hu.reuse || []).filter(dep => dep !== huId);
  }
  plan.updatedAt = new Date().toISOString();
  return true;
}

/**
 * Partial update of an HU.
 * @param {object} plan
 * @param {string} huId
 * @param {object} patch - fields to update (title, scope, task_type, acceptance_criteria, acceptance_tests, blocked_by)
 * @returns {object|null} updated HU or null if not found
 */
export function updateHu(plan, huId, patch) {
  const hu = plan.hus.find(h => h.id === huId);
  if (!hu) return null;
  const allowed = ["title", "task_type", "scope", "acceptance_criteria", "acceptance_tests", "blocked_by", "reuse", "spec_section", "result", "short_id"];
  for (const key of allowed) {
    if (patch[key] !== undefined) hu[key] = patch[key];
  }
  hu.updatedAt = new Date().toISOString();
  plan.updatedAt = new Date().toISOString();
  return hu;
}

/**
 * Update HU status.
 * @returns {boolean} true if updated
 */
export function updateHuStatus(plan, huId, status) {
  const hu = plan.hus.find(h => h.id === huId);
  if (!hu) return false;
  hu.status = status;
  hu.updatedAt = new Date().toISOString();
  plan.updatedAt = new Date().toISOString();
  return true;
}

/**
 * Stamp the per-HU outcome — what actually happened during execution.
 * Written ONCE per HU, at the end of runSingleHu in hu-sub-pipeline.
 * Consumed by the board to render the per-HU summary indicator and
 * by `kj report` for retrospective inspection.
 *
 * Shape (every field optional except status + finishedAt):
 *   {
 *     status:       "done" | "failed" | "blocked",
 *     iterations:   number,        // how many coder→reviewer rounds
 *     duration_ms:  number,        // wall-clock for this HU
 *     branch:       string|null,   // git branch the coder used
 *     commits:      string[],      // SHA list captured during the run
 *     pr_url:       string|null,
 *     blockers:     string[],      // why it failed/was blocked, plain
 *     summary:      string,        // 1-2 sentence human summary
 *     finishedAt:   ISO timestamp
 *   }
 *
 * @returns {boolean} true if the HU was found and the outcome stored
 */
export function setHuOutcome(plan, huId, outcome) {
  const hu = plan.hus.find(h => h.id === huId);
  if (!hu) return false;
  hu.outcome = {
    status: outcome.status || hu.status || null,
    iterations: outcome.iterations ?? null,
    duration_ms: outcome.duration_ms ?? null,
    branch: outcome.branch ?? null,
    commits: Array.isArray(outcome.commits) ? outcome.commits : [],
    pr_url: outcome.pr_url ?? null,
    blockers: Array.isArray(outcome.blockers) ? outcome.blockers : [],
    summary: outcome.summary || "",
    finishedAt: outcome.finishedAt || new Date().toISOString(),
  };
  hu.updatedAt = new Date().toISOString();
  plan.updatedAt = new Date().toISOString();
  return true;
}

/**
 * Stamp the plan-level rollup once every HU has finished. Built from
 * the per-HU outcomes so the board can show "Plan finished · 8 done
 * · 2 failed · 1 blocked · 15 min" in one banner.
 *
 *   {
 *     status:       "done" | "partial" | "failed",
 *     total:        number,
 *     counts:       { done, failed, blocked, pending },
 *     duration_ms:  number,
 *     prs:          string[],            // unique pr_url across HUs
 *     blockers:     string[],            // dedup'd blockers
 *     finishedAt:   ISO timestamp,
 *   }
 */
export function setPlanOutcome(plan, outcome) {
  plan.outcome = {
    status: outcome.status || "partial",
    total: outcome.total ?? (plan.hus?.length || 0),
    counts: outcome.counts || { done: 0, failed: 0, blocked: 0, pending: 0 },
    duration_ms: outcome.duration_ms ?? null,
    prs: Array.isArray(outcome.prs) ? [...new Set(outcome.prs.filter(Boolean))] : [],
    blockers: Array.isArray(outcome.blockers) ? [...new Set(outcome.blockers.filter(Boolean))] : [],
    finishedAt: outcome.finishedAt || new Date().toISOString(),
  };
  plan.updatedAt = new Date().toISOString();
}

/**
 * PR-E: auto-promote every pending HU with at least one acceptance
 * test to "certified". The intermediate "certified" state was an
 * invisible wall — there's no UI button for it and the user had no
 * way to discover `kj plan ready`. Treating pending-with-tests as
 * runnable removes the wall while keeping the test contract gate.
 *
 * Mutates plan in place. HUs in done / failed / blocked are left
 * alone so re-runs stay explicit (use --hu <id>).
 *
 * @returns {number} how many HUs were promoted (0 if nothing changed).
 */
export function autoCertifyPendingHus(plan) {
  if (!plan?.hus?.length) return 0;
  let promoted = 0;
  const now = new Date().toISOString();
  for (const hu of plan.hus) {
    if (hu.status === "pending" && Array.isArray(hu.acceptance_tests) && hu.acceptance_tests.length > 0) {
      hu.status = "certified";
      hu.updatedAt = now;
      promoted += 1;
    }
  }
  if (promoted > 0) plan.updatedAt = now;
  return promoted;
}

/**
 * PR-E: assert that the plan has at least one HU that's actually
 * going to run. Throws with a plain-Spanish message otherwise so
 * `kj run --plan` can never silently fall back to single-task mode
 * and burn tokens for nothing.
 *
 * The set of "runnable" statuses matches the sub-pipeline filter
 * (today: certified). The caller should run autoCertifyPendingHus()
 * BEFORE this so pending-with-tests get a chance.
 *
 * @throws {Error} when no HU is runnable.
 */
export function assertPlanRunnable(plan, planId) {
  if (!plan?.hus?.length) {
    throw new Error(
      `El plan ${planId} no contiene ninguna HU. `
      + `Edita el plan o vuelve a generarlo con \`kj plan\`. `
      + `Aborto para no malgastar tokens en un fallback de "single task".`
    );
  }
  const certified = plan.hus.filter((h) => h.status === "certified").length;
  if (certified > 0) return;
  const counts = plan.hus.reduce((acc, h) => {
    const k = h.status || "pending";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ");
  throw new Error(
    `Plan ${planId}: 0 HU(s) listas para ejecutar (estados: ${summary}). `
    + `Si las HU(s) están en done/failed/blocked y quieres relanzarlas, usa --hu <id>. `
    + `Aborto para no malgastar tokens en un fallback de "single task".`
  );
}

/**
 * Compute the rollup from the per-HU outcomes already stamped on the
 * plan. Invoked by syncResultsToPlan in plan-executor when the run
 * ends so the caller doesn't have to assemble the counts by hand.
 */
export function computePlanOutcome(plan, { duration_ms = null } = {}) {
  const hus = plan.hus || [];
  const counts = { done: 0, failed: 0, blocked: 0, pending: 0 };
  const prs = [];
  const blockers = [];
  for (const hu of hus) {
    const status = hu.outcome?.status || hu.status || "pending";
    if (counts[status] !== undefined) counts[status] += 1;
    else counts.pending += 1;
    if (hu.outcome?.pr_url) prs.push(hu.outcome.pr_url);
    if (Array.isArray(hu.outcome?.blockers)) blockers.push(...hu.outcome.blockers);
  }
  let status = "done";
  if (counts.failed > 0 || counts.blocked > 0) status = counts.done > 0 ? "partial" : "failed";
  if (counts.done === 0 && counts.failed === 0 && counts.blocked === 0) status = "pending";
  return {
    status,
    total: hus.length,
    counts,
    duration_ms,
    // Dedupe at the rollup boundary — same PR / blocker reported by
    // multiple HUs is noise in the banner.
    prs: [...new Set(prs.filter(Boolean))],
    blockers: [...new Set(blockers.filter(Boolean))],
    finishedAt: new Date().toISOString(),
  };
}

/**
 * Mark all pending HUs as certified (ready to execute).
 * Sets plan status to "ready".
 * @returns {number} count of certified HUs
 */
export function certifyAllHus(plan) {
  let count = 0;
  for (const hu of plan.hus) {
    if (hu.status === "pending") {
      hu.status = "certified";
      hu.updatedAt = new Date().toISOString();
      count++;
    }
  }
  plan.status = "ready";
  plan.updatedAt = new Date().toISOString();
  return count;
}

/**
 * Reorder HUs by providing an ordered list of IDs.
 * Updates blocked_by to reflect the linear order.
 * @param {object} plan
 * @param {string[]} orderedIds
 */
export function reorderHus(plan, orderedIds) {
  const map = new Map(plan.hus.map(h => [h.id, h]));
  const reordered = [];
  for (const id of orderedIds) {
    const hu = map.get(id);
    if (hu) reordered.push(hu);
  }
  // Add any HUs not in the ordered list at the end
  for (const hu of plan.hus) {
    if (!orderedIds.includes(hu.id)) reordered.push(hu);
  }
  plan.hus = reordered;
  plan.updatedAt = new Date().toISOString();
}
