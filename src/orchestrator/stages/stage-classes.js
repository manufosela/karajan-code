/**
 * StageExecutor class wrappers for the first 3 pipeline stages adopted
 * under KJC-TSK-0328 (triage, coder, reviewer).
 *
 * Why these 3:
 *   - Triage is the first stage a pipeline runs — proves the registry is
 *     consulted before any execution.
 *   - Coder runs inside the iteration loop — proves the contract works
 *     for stages that run N times per pipeline.
 *   - Reviewer has the most complex signature (fetchReviewDiff + handle
 *     rejection + Solomon escalation path) — proves the contract does not
 *     artificially limit stage complexity.
 *
 * Contract: each class extends StageExecutor and delegates `execute(ctx)`
 * to the existing `run{Stage}Stage` function. This keeps back-compat:
 * flow-runner can still call the function directly during the transition,
 * while the registry path is available for future iterations (and for
 * anyone writing a new stage).
 *
 * A shared `stageRegistry` singleton is exported with the 3 stages
 * pre-registered so callers do `stageRegistry.get("coder")` without
 * rebuilding the registry.
 *
 * Future Oleada 3 will finish the migration by having flow-runner ONLY
 * use the registry path, deleting the direct function imports.
 */

import { StageExecutor, StageRegistry } from "./stage-executor.js";
import { runTriageStage } from "./triage-stage.js";
import { runCoderStage } from "./coder-stage.js";
import { runReviewerStage } from "./reviewer-stage.js";

export class TriageStage extends StageExecutor {
  constructor() { super("triage"); }
  canRun(ctx) {
    // Triage runs when the triage pipeline flag is on (default: true for
    // kj_run; tests may flip it off via config.pipeline.triage.enabled).
    return ctx?.pipelineFlags?.triageEnabled !== false;
  }
  async execute(ctx) {
    return runTriageStage(ctx);
  }
}

export class CoderStage extends StageExecutor {
  constructor() { super("coder"); }
  canRun(ctx) {
    // Coder always runs unless the analysis-only path disables it.
    return ctx?.pipelineFlags?.coderRequired !== false;
  }
  async execute(ctx) {
    return runCoderStage(ctx);
  }
}

export class ReviewerStage extends StageExecutor {
  constructor() { super("reviewer"); }
  canRun(ctx) {
    return ctx?.pipelineFlags?.reviewerEnabled !== false;
  }
  async execute(ctx) {
    return runReviewerStage(ctx);
  }
}

/**
 * Shared registry singleton with the 3 pre-registered stages. New stages
 * should be added here as they migrate to the StageExecutor contract.
 */
export const stageRegistry = new StageRegistry();
stageRegistry.register(new TriageStage());
stageRegistry.register(new CoderStage());
stageRegistry.register(new ReviewerStage());

export { StageExecutor, StageRegistry };
