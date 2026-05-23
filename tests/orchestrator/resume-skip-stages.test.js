/**
 * Regression pin for KJC-BUG-0058.
 *
 * `kj resume` used to call `runFlow` without rehydrating stage results
 * from the loaded session, so pre-loop stages (researcher, architect,
 * planner…) ran from scratch. The fix is two-layered:
 *
 *   1. `setStageBundle` persists each pre-loop stage's cross-stage
 *      context (researchContext, architectContext, plannedTask) into
 *      `session.stage_bundles`, alongside the stageResult that
 *      `setStageResult` mirrors into `stage_results` + `stages_completed`.
 *
 *   2. `init-context.js` rehydrates `ctx.stageResults` from
 *      `session.stage_results` before invoking `runPreLoopStages`, so the
 *      planning helpers (`persistStage` / `resumeSkip`) find the cached
 *      entries and short-circuit the LLM call.
 *
 * Acceptance:
 *   A) `setStageBundle` mirrors stageResult + stages_completed correctly.
 *   B) `setStageResult` is idempotent (does not duplicate names in the
 *      flat array).
 *   C) Bundle round-trips: write `researcher` bundle, read it back,
 *      `bundles.researcher.researchContext` is preserved.
 */
import { describe, expect, it } from "vitest";
import { setStageResult, setStageBundle } from "../../src/session/mutators.js";

describe("setStageResult / setStageBundle — KJC-BUG-0058", () => {
  it("A) setStageBundle mirrors stageResult + stages_completed", () => {
    const session = {};
    setStageBundle(session, "researcher", {
      stageResult: { summary: "found 3 files", duration_ms: 1234 },
      researchContext: { hints: ["read README", "scan src/"] },
    });
    expect(session.stage_bundles.researcher.researchContext.hints).toEqual([
      "read README",
      "scan src/",
    ]);
    expect(session.stage_results.researcher.summary).toBe("found 3 files");
    expect(session.stages_completed).toEqual(["researcher"]);
  });

  it("B) setStageResult is idempotent on stages_completed", () => {
    const session = {};
    setStageResult(session, "triage", { level: "simple" });
    setStageResult(session, "triage", { level: "complex" }); // overwrite
    setStageResult(session, "researcher", { ok: true });
    expect(session.stages_completed).toEqual(["triage", "researcher"]);
    expect(session.stage_results.triage.level).toBe("complex");
  });

  it("C) bundle round-trips with multiple stages preserving each context", () => {
    const session = {};
    setStageBundle(session, "researcher", {
      stageResult: { summary: "r" },
      researchContext: { topic: "auth" },
    });
    setStageBundle(session, "architect", {
      stageResult: { summary: "a" },
      architectContext: { layers: ["api", "db"] },
    });
    setStageBundle(session, "planner", {
      stageResult: { summary: "p" },
      plannedTask: "Implement auth across api+db",
    });
    expect(session.stage_bundles.researcher.researchContext.topic).toBe("auth");
    expect(session.stage_bundles.architect.architectContext.layers).toEqual(["api", "db"]);
    expect(session.stage_bundles.planner.plannedTask).toBe("Implement auth across api+db");
    expect(session.stages_completed).toEqual(["researcher", "architect", "planner"]);
  });
});
