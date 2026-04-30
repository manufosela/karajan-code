/**
 * Iteration phase: post-loop wiring + session finalization when the
 * reviewer approves.
 *
 * Extracted verbatim from `src/orchestrator/drivers/iteration-loop.js` in
 * the v2.7.x audit follow-up to keep the iteration-loop driver under the
 * 600-LOC ceiling. Behaviour is byte-for-byte identical to the inlined
 * version.
 *
 * Returns { action: "return" | "continue", result? }.
 *   - "return"   → caller returns `result` (final approved session).
 *   - "continue" → caller continues the iteration loop.
 */

import { resetRetryCount } from "../../../session/mutators.js";
import { handlePostLoopStages, finalizeApprovedSession } from "../post-loop.js";

export async function handleApprovedReview({ config, session, emitter, eventBase, coderRole, trackBudget, i, task, stageResults, pipelineFlags, askQuestion, logger, gitCtx, budgetSummary, pgCard, pgProject, review, rtkTracker, brainCtx }) {
  resetRetryCount(session, "reviewer");
  const postLoopResult = await handlePostLoopStages({
    config, session, emitter, eventBase, coderRole, trackBudget, i, task, stageResults,
    ciEnabled: Boolean(config.ci?.enabled), testerEnabled: pipelineFlags.testerEnabled, securityEnabled: pipelineFlags.securityEnabled, askQuestion, logger, brainCtx
  });
  if (postLoopResult.action === "return") return { action: "return", result: postLoopResult.result };
  if (postLoopResult.action === "continue") return { action: "continue" };

  const result = await finalizeApprovedSession({ config, gitCtx, task, logger, session, stageResults, emitter, eventBase, budgetSummary, pgCard, pgProject, review, i, rtkTracker });
  return { action: "return", result };
}
