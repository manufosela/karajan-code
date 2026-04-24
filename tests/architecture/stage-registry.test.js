/**
 * Architecture regression guard — StageExecutor contract is NOT dead
 * abstraction.
 *
 * Pre-v2.7.5 this was a HIGH finding in the self-audit: the
 * StageExecutor + StageRegistry contract existed in
 * src/orchestrator/stages/stage-executor.js but NOT A SINGLE stage
 * extended it (grep "extends StageExecutor" = 0). The contract was dead
 * abstraction that lied about the architecture in ARCHITECTURE.md.
 *
 * TSK-0328 adopted it for triage, coder and reviewer. This test enforces
 * the adoption: at least those 3 stages are present in the shared
 * registry and extend StageExecutor. If the registry loses them, or if
 * someone deletes the classes, CI fails loud.
 *
 * As new stages migrate (Oleada 3), add them to this test.
 */

import { describe, expect, it } from "vitest";
import { StageExecutor } from "../../src/orchestrator/stages/stage-executor.js";
import {
  stageRegistry,
  TriageStage,
  CoderStage,
  ReviewerStage,
} from "../../src/orchestrator/stages/stage-classes.js";

describe("architecture/stage-registry — StageExecutor contract is load-bearing", () => {
  it("at least 3 stages are registered (triage, coder, reviewer)", () => {
    expect(stageRegistry.size).toBeGreaterThanOrEqual(3);
  });

  it("each required stage is registered under its canonical name", () => {
    for (const name of ["triage", "coder", "reviewer"]) {
      expect(stageRegistry.has(name), `stage "${name}" missing from registry`).toBe(true);
    }
  });

  it("each registered stage is an instance of StageExecutor", () => {
    for (const stage of stageRegistry.list()) {
      expect(
        stage instanceof StageExecutor,
        `stage "${stage?.name}" must extend StageExecutor`,
      ).toBe(true);
    }
  });

  it("canRun/execute/onFailure are functions on each stage", () => {
    for (const stage of stageRegistry.list()) {
      expect(typeof stage.canRun).toBe("function");
      expect(typeof stage.execute).toBe("function");
      expect(typeof stage.onFailure).toBe("function");
    }
  });

  it("class shape: the 3 named exports all extend StageExecutor", () => {
    expect(new TriageStage() instanceof StageExecutor).toBe(true);
    expect(new CoderStage() instanceof StageExecutor).toBe(true);
    expect(new ReviewerStage() instanceof StageExecutor).toBe(true);
  });
});
