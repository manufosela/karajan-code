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

  // TSK-0336: the registry isn't just alive, it's consulted by production code.
  // drivers/pre-loop.js routes triage and drivers/iteration-loop.js routes
  // coder + reviewer through `runStage(stageRegistry.get("<name>"), ctx)`.
  // If someone reverts to direct `runTriageStage(...)` / `runCoderStage(...)`
  // calls, that's the regression the audit was trying to prevent — the
  // registry exists but nobody looks at it. This test fails CI in that case.
  it("drivers/pre-loop.js routes triage through stageRegistry.get(\"triage\")", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
    const text = await fs.readFile(path.join(repoRoot, "src/orchestrator/drivers/pre-loop.js"), "utf8");
    expect(text).toMatch(/runStage\(\s*stageRegistry\.get\(\s*["']triage["']\s*\)/);
  });

  it("drivers/iteration-loop.js routes coder + reviewer through stageRegistry.get(...)", async () => {
    // v2.7.x audit follow-up: the coder and reviewer phase bodies were
    // extracted to ./iteration-phases/coder-and-refactorer.js and
    // ./iteration-phases/reviewer-gate.js to keep iteration-loop.js
    // under the 600-LOC ceiling. The StageRegistry contract is still
    // load-bearing — assert it at the new addresses.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
    const coderText = await fs.readFile(path.join(repoRoot, "src/orchestrator/drivers/iteration-phases/coder-and-refactorer.js"), "utf8");
    const reviewerText = await fs.readFile(path.join(repoRoot, "src/orchestrator/drivers/iteration-phases/reviewer-gate.js"), "utf8");
    expect(coderText).toMatch(/runStage\(\s*stageRegistry\.get\(\s*["']coder["']\s*\)/);
    expect(reviewerText).toMatch(/runStage\(\s*stageRegistry\.get\(\s*["']reviewer["']\s*\)/);
  });
});
