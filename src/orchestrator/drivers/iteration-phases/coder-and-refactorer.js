/**
 * Iteration phase: coder (+ refactorer if enabled) with standby handling.
 *
 * Extracted verbatim from `src/orchestrator/drivers/iteration-loop.js` in
 * the v2.7.x audit follow-up to keep the iteration-loop driver under the
 * 600-LOC ceiling. Behaviour is byte-for-byte identical to the inlined
 * version. The extraction follows the same pattern as
 * `pre-loop-phases/` (see TSK-0337).
 *
 * Returns { action: "ok" | "return" | "retry", result? }.
 *   - "ok"     → caller continues to the next phase.
 *   - "return" → caller returns `result` to its own caller (pause/abort).
 *   - "retry"  → caller decrements its iteration counter and retries.
 */

import { runRefactorerStage } from "../../iteration-stages.js";
import { stageRegistry } from "../../stages/stage-classes.js";
import { runStage } from "../../stages/stage-executor.js";
import { handleStandbyResult } from "../error-recovery.js";

/**
 * A coder/refactorer stage hit a provider quota cap and Brain Recovery
 * hibernated the run. Turn it into a clean loop return carrying
 * `hibernated:true` — the iteration loop and flow-runner read that to
 * seal the session as `hibernated` (NOT `failed`) so it stays resumable.
 */
function hibernateReturn(stageResult, session) {
  return {
    action: "return",
    result: {
      hibernated: true,
      sessionId: session?.id || null,
      reason: "quota_exhausted",
      standbyFile: stageResult.standbyFile || null,
      recovery: stageResult.recovery || null,
    },
  };
}

export async function runCoderAndRefactorerStages({ coderRoleInstance, coderRole, refactorerRole, pipelineFlags, config, logger, emitter, eventBase, session, plannedTask, trackBudget, i, brainCtx }) {
  // Coder via StageRegistry (TSK-0336). canRun = coderRequired !== false; in
  // analysis-only task types coderRequired is set to false by policy, so the
  // stage is never even entered — matches the previous guard at the top of
  // runFlow.
  const coderCtx = { coderRoleInstance, coderRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration: i, brainCtx, pipelineFlags };
  const coderResult = await runStage(stageRegistry.get("coder"), coderCtx);
  if (coderResult?.action === "hibernate") return hibernateReturn(coderResult, session);
  if (coderResult?.action === "pause") return { action: "return", result: coderResult.result };
  const coderStandby = await handleStandbyResult({ stageResult: coderResult, session, emitter, eventBase, i, stage: "coder", logger, config });
  if (coderStandby.handled) {
    return coderStandby.action === "return"
      ? { action: "return", result: coderStandby.result }
      : { action: "retry" };
  }

  if (pipelineFlags.refactorerEnabled) {
    const refResult = await runRefactorerStage({ refactorerRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration: i });
    if (refResult?.action === "hibernate") return hibernateReturn(refResult, session);
    if (refResult?.action === "pause") return { action: "return", result: refResult.result };
    const refStandby = await handleStandbyResult({ stageResult: refResult, session, emitter, eventBase, i, stage: "refactorer", logger, config });
    if (refStandby.handled) {
      return refStandby.action === "return"
        ? { action: "return", result: refStandby.result }
        : { action: "retry" };
    }
  }

  return { action: "ok" };
}
