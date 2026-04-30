/**
 * Iteration phase: reviewer stage with standby handling.
 *
 * Extracted verbatim from `src/orchestrator/drivers/iteration-loop.js` in
 * the v2.7.x audit follow-up to keep the iteration-loop driver under the
 * 600-LOC ceiling. Behaviour is byte-for-byte identical to the inlined
 * version.
 *
 * Returns { action: "ok" | "return" | "retry", review?, result? }.
 *   - "ok"     → caller proceeds with `review` (approved or with blocking
 *                issues).
 *   - "return" → caller returns `result` (pause / stalled).
 *   - "retry"  → caller decrements its iteration counter and retries.
 */

import { stageRegistry } from "../../stages/stage-classes.js";
import { runStage } from "../../stages/stage-executor.js";
import { handleStandbyResult } from "../error-recovery.js";

export async function runReviewerGateStage({ pipelineFlags, reviewerRole, config, logger, emitter, eventBase, session, trackBudget, i, reviewRules, task, repeatDetector, budgetSummary, askQuestion, brainCtx }) {
  // Reviewer via StageRegistry (TSK-0336). ReviewerStage.canRun returns
  // `reviewerEnabled !== false`; when false, runStage returns null and we
  // synthesize the "disabled-by-pipeline" stub (same shape as the previous
  // early-return). Otherwise execute() runs runReviewerStage.
  const reviewerCtx = {
    reviewerRole, config, logger, emitter, eventBase, session, trackBudget,
    iteration: i, reviewRules, task, repeatDetector, budgetSummary, askQuestion,
    brainCtx, pipelineFlags,
  };
  const reviewerResult = await runStage(stageRegistry.get("reviewer"), reviewerCtx);
  if (reviewerResult === null) {
    return {
      action: "ok",
      review: { approved: true, blocking_issues: [], non_blocking_suggestions: [], summary: "Reviewer disabled by pipeline", confidence: 1 }
    };
  }
  if (reviewerResult.action === "pause") return { action: "return", result: reviewerResult.result };
  const revStandby = await handleStandbyResult({ stageResult: reviewerResult, session, emitter, eventBase, i, stage: "reviewer", logger, config, askQuestion });
  if (revStandby.handled) {
    if (revStandby.action === "return") return { action: "return", result: revStandby.result };
    if (revStandby.action === "skip") {
      // Solomon said skip review — treat as approved
      return { action: "ok", review: { approved: true, blocking_issues: [], non_blocking_suggestions: [], summary: "Review skipped (agent rate-limited, Solomon approved)", confidence: 0.7 } };
    }
    if (revStandby.action === "retry_reviewer_only") {
      // Retry just the reviewer — use alternative agent if Solomon recommended one
      let retryReviewerRole = reviewerRole;
      const alt = session._alternative_agent;
      if (alt?.stage === "reviewer" && alt?.provider) {
        retryReviewerRole = { provider: alt.provider, model: null };
        logger.info(`Retrying reviewer with alternative agent: ${alt.provider}`);
        delete session._alternative_agent;
      }
      return runReviewerGateStage({ pipelineFlags: { reviewerEnabled: true }, reviewerRole: retryReviewerRole, config, logger, emitter, eventBase, session, trackBudget, i, reviewRules, task, repeatDetector, budgetSummary, askQuestion });
    }
    return { action: "retry" };
  }
  if (reviewerResult.stalled) return { action: "return", result: reviewerResult.stalledResult };
  return { action: "ok", review: reviewerResult.review };
}
