/**
 * Plan Executor — bridge between v2 plans and hu-sub-pipeline.
 * Converts plan.hus into the format expected by runHuSubPipeline,
 * and syncs execution results back to the plan file.
 */

import { isPlanV2 } from "./plan-schema.js";
import { updateHuStatus, updateHu, computePlanOutcome, setPlanOutcome } from "./plan-hu-ops.js";

/**
 * Convert a v2 plan's HUs into the stageResults.huReviewer format
 * expected by needsSubPipeline + runHuSubPipeline.
 * @param {object} plan - v2 plan with plan.hus
 * @returns {object} { ok, stories, total, certified, batchSessionId, planId }
 */
export function planToHuBatch(plan) {
  if (!isPlanV2(plan) || !plan.hus?.length) {
    return { ok: false, stories: [], total: 0, certified: 0 };
  }

  const stories = plan.hus.map(hu => ({
    id: hu.id,
    title: hu.title,
    task_type: hu.task_type || "sw",
    status: hu.status === "certified" ? "certified" : hu.status,
    blocked_by: hu.blocked_by || [],
    // KJC-BUG-0110: scope must survive as its own field — the parallel
    // scheduler treats a scopeless story as exclusive, so dropping it
    // silently degrades --parallel N to sequential.
    scope: hu.scope || null,
    certified: { text: hu.scope || hu.title },
    acceptance_criteria: hu.acceptance_criteria || [],
    acceptance_tests: hu.acceptance_tests || [],
    // PR F (v2.7.5): forward the SPEC section pointer into the story
    // so the per-HU loop in flow-runner can hand it to the coder
    // prompt without having to re-load the plan from disk.
    spec_section: hu.spec_section || null,
    original: { text: hu.scope || hu.title }
  }));

  const certified = stories.filter(s => s.status === "certified").length;

  return {
    ok: certified > 0,
    stories,
    total: stories.length,
    certified,
    batchSessionId: `plan-${plan.planId}`,
    planId: plan.planId,
    // PR F (v2.7.5): plan-wide reviewer findings ride along the batch
    // so the coder can be told about issues that touch its HU. The
    // shape mirrors plan-reviewer.js output (missing_dependencies,
    // scope_overlaps, order_issues, …) — null when the reviewer
    // never ran for this plan.
    review: plan.review || null,
    auto_generated: false,
    source: { plan: true, planId: plan.planId }
  };
}

/**
 * Sync execution results from hu-sub-pipeline back to the plan file.
 * Updates each HU's status based on the sub-pipeline results.
 * @param {object} plan - v2 plan (mutated in place)
 * @param {object} subPipelineResult - { results: [{huId, approved}], blockedIds }
 */
export function syncResultsToPlan(plan, subPipelineResult) {
  if (!isPlanV2(plan)) return;

  // KJC-TSK-0403: status/result ortogonal. HU fallida queda en status=pending
  // con result=fail (no status=failed) para que el usuario pueda relanzarla
  // con el contexto del fallo previo. El plan se considera failed si CUALQUIER
  // HU tiene result=fail.
  for (const r of subPipelineResult.results || []) {
    if (r.approved) {
      updateHuStatus(plan, r.huId, "done");
      updateHu(plan, r.huId, { result: "pass" });
    } else {
      updateHuStatus(plan, r.huId, "pending");
      updateHu(plan, r.huId, { result: "fail" });
    }
  }

  for (const blockedId of subPipelineResult.blockedIds || []) {
    updateHuStatus(plan, blockedId, "blocked");
  }

  const allDone = plan.hus.every(h => h.status === "done");
  const anyFailed = plan.hus.some(h => h.result === "fail");
  plan.status = allDone ? "done" : anyFailed ? "failed" : "running";
  plan.updatedAt = new Date().toISOString();

  // PR3: stamp the plan-level rollup so the board can show the
  // "Plan finalizado · X done · Y failed · Z blocked · D min" banner
  // without recomputing it on every render. Built from the per-HU
  // outcomes that hu-sub-pipeline already wrote on the way through.
  const duration_ms = subPipelineResult.duration_ms ?? null;
  const rollup = computePlanOutcome(plan, { duration_ms });
  setPlanOutcome(plan, rollup);
}
