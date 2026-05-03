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

// TSK-0336: stage subclasses use DYNAMIC imports inside execute() so that
// loading this module does not pull in the whole roles/ + agents/ graph.
// Orchestrator tests mock role/agent modules partially — eagerly importing
// triage-stage / coder-stage / reviewer-stage here would cascade through
// agent-role.js → BaseRole and crash those partial mocks. Deferring the
// import keeps canRun/construction cheap and the test surface unchanged.
export class TriageStage extends StageExecutor {
  constructor() { super("triage"); }
  canRun(ctx) {
    // Triage runs when the triage pipeline flag is on (default: true for
    // kj_run; tests may flip it off via config.pipeline.triage.enabled).
    return ctx?.pipelineFlags?.triageEnabled !== false;
  }
  async execute(ctx) {
    // Import via the pre-loop-stages barrel so test mocks that target
    // `src/orchestrator/pre-loop-stages.js` (the historical surface) still
    // apply when a stage is invoked via the registry.
    const { runTriageStage } = await import("../pre-loop-stages.js");
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
    // Import via iteration-stages barrel for the same reason as TriageStage —
    // preserve the existing mock surface used by orchestrator unit tests.
    const { runCoderStage } = await import("../iteration-stages.js");
    return runCoderStage(ctx);
  }
}

export class ReviewerStage extends StageExecutor {
  constructor() { super("reviewer"); }
  canRun(ctx) {
    return ctx?.pipelineFlags?.reviewerEnabled !== false;
  }
  async execute(ctx) {
    const { runReviewerStage } = await import("../iteration-stages.js");
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
