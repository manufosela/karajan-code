/**
 * Plan Executor — bridge between v2 plans and hu-sub-pipeline.
 * Converts plan.hus into the format expected by runHuSubPipeline,
 * and syncs execution results back to the plan file.
 */

import { isPlanV2 } from "./plan-schema.js";
import { updateHuStatus } from "./plan-hu-ops.js";

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
    certified: { text: hu.scope || hu.title },
    acceptance_criteria: hu.acceptance_criteria || [],
    acceptance_tests: hu.acceptance_tests || [],
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

  for (const r of subPipelineResult.results || []) {
    const status = r.approved ? "done" : "failed";
    updateHuStatus(plan, r.huId, status);
  }

  for (const blockedId of subPipelineResult.blockedIds || []) {
    updateHuStatus(plan, blockedId, "blocked");
  }

  const allDone = plan.hus.every(h => h.status === "done");
  const anyFailed = plan.hus.some(h => h.status === "failed");
  plan.status = allDone ? "done" : anyFailed ? "failed" : "running";
  plan.updatedAt = new Date().toISOString();
}
