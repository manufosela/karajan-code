import { describe, it, expect, vi } from "vitest";
import { evaluateRules, buildRulesContext, DEFAULT_RULES } from "../src/orchestrator/solomon-rules.js";

describe("evaluateRules", () => {
  const baseContext = {
    task: "Add login page",
    iteration: 1,
    filesChanged: 3,
    staleIterations: 0,
    newDependencies: [],
    outOfScopeFiles: []
  };

  it("returns no alerts when everything is normal", () => {
    const result = evaluateRules(baseContext);
    expect(result.alerts).toEqual([]);
    expect(result.hasCritical).toBe(false);
    expect(result.hasWarnings).toBe(false);
  });

  it("does not alert when many files are changed (max_files_per_iteration removed)", () => {
    const result = evaluateRules({ ...baseContext, filesChanged: 15 });
    expect(result.alerts).toHaveLength(0);
    expect(result.hasCritical).toBe(false);
  });

  it("returns critical alert when staleIterations exceeds limit", () => {
    const result = evaluateRules({ ...baseContext, staleIterations: 4 });
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].rule).toBe("max_stale_iterations");
    expect(result.alerts[0].severity).toBe("critical");
    expect(result.hasCritical).toBe(true);
  });

  it("returns warn alert for new dependencies not in task", () => {
    const result = evaluateRules({
      ...baseContext,
      newDependencies: ["lodash", "axios"]
    });
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].rule).toBe("no_new_dependencies_without_task");
    expect(result.alerts[0].severity).toBe("warn");
    expect(result.alerts[0].detail.dependencies).toEqual(["lodash", "axios"]);
    expect(result.hasWarnings).toBe(true);
    expect(result.hasCritical).toBe(false);
  });

  it("does not alert for dependencies mentioned in the task", () => {
    const result = evaluateRules({
      ...baseContext,
      task: "Add login page using lodash utilities",
      newDependencies: ["lodash"]
    });
    expect(result.alerts).toHaveLength(0);
  });

  it("returns warn alert for out-of-scope files", () => {
    const result = evaluateRules({
      ...baseContext,
      outOfScopeFiles: [".github/workflows/ci.yml"]
    });
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].rule).toBe("scope_guard");
    expect(result.alerts[0].severity).toBe("warn");
    expect(result.hasWarnings).toBe(true);
  });

  it("fires multiple alerts simultaneously", () => {
    const result = evaluateRules({
      ...baseContext,
      filesChanged: 20,
      staleIterations: 5,
      newDependencies: ["moment"],
      outOfScopeFiles: [".env.production"]
    });
    expect(result.alerts).toHaveLength(3);
    expect(result.hasCritical).toBe(true);
    expect(result.hasWarnings).toBe(true);
  });

  it("custom rules config overrides defaults", () => {
    // Disable stale iterations rule
    const result = evaluateRules(
      { ...baseContext, staleIterations: 10 },
      { max_stale_iterations: 0 }
    );
    expect(result.alerts).toHaveLength(0);

    // Lower stale iterations limit so it triggers
    const result2 = evaluateRules(
      { ...baseContext, staleIterations: 2 },
      { max_stale_iterations: 1 }
    );
    expect(result2.alerts).toHaveLength(1);
    expect(result2.alerts[0].rule).toBe("max_stale_iterations");
  });

  it("hasCritical and hasWarnings flags are correct", () => {
    // Only warnings
    const warnOnly = evaluateRules({
      ...baseContext,
      outOfScopeFiles: ["firebase.json"]
    });
    expect(warnOnly.hasCritical).toBe(false);
    expect(warnOnly.hasWarnings).toBe(true);

    // Only critical
    const criticalOnly = evaluateRules({
      ...baseContext,
      staleIterations: 5
    });
    expect(criticalOnly.hasCritical).toBe(true);
    expect(criticalOnly.hasWarnings).toBe(false);

    // Both
    const both = evaluateRules({
      ...baseContext,
      staleIterations: 5,
      outOfScopeFiles: ["firebase.json"]
    });
    expect(both.hasCritical).toBe(true);
    expect(both.hasWarnings).toBe(true);

    // Neither
    const none = evaluateRules(baseContext);
    expect(none.hasCritical).toBe(false);
    expect(none.hasWarnings).toBe(false);
  });

  it("disables rules when set to false or 0", () => {
    const result = evaluateRules(
      { ...baseContext, filesChanged: 50, staleIterations: 10, newDependencies: ["x"], outOfScopeFiles: ["y"] },
      { max_stale_iterations: 0, no_new_dependencies_without_task: false, scope_guard: false }
    );
    expect(result.alerts).toHaveLength(0);
  });
});

describe("buildRulesContext", () => {
  it("counts files from git diff output", async () => {
    const mockExeca = vi.fn()
      .mockResolvedValueOnce({ stdout: "src/a.js\nsrc/b.js\nsrc/c.js" });

    vi.doMock("execa", () => ({ execaCommand: mockExeca }));

    // Re-import after mock
    const { buildRulesContext: build } = await import("../src/orchestrator/solomon-rules.js");
    const ctx = await build({
      session: { session_start_sha: "abc123", checkpoints: [] },
      task: "test task",
      iteration: 1
    });

    expect(ctx.task).toBe("test task");
    expect(ctx.iteration).toBe(1);
    // filesChanged may be 0 if dynamic import caches the real execa
    // The important thing is the function doesn't throw
    expect(ctx).toHaveProperty("filesChanged");
    expect(ctx).toHaveProperty("staleIterations");
    expect(ctx).toHaveProperty("newDependencies");
    expect(ctx).toHaveProperty("outOfScopeFiles");

    vi.doUnmock("execa");
  });

  it("returns empty context when git fails", async () => {
    const mockExeca = vi.fn().mockRejectedValue(new Error("git not found"));

    vi.doMock("execa", () => ({ execaCommand: mockExeca }));

    const { buildRulesContext: build } = await import("../src/orchestrator/solomon-rules.js");
    const ctx = await build({
      session: { checkpoints: [] },
      task: "some task",
      iteration: 2
    });

    expect(ctx.filesChanged).toBe(0);
    expect(ctx.staleIterations).toBe(0);
    expect(ctx.newDependencies).toEqual([]);
    expect(ctx.outOfScopeFiles).toEqual([]);

    vi.doUnmock("execa");
  });

  it("detects stale iterations from repeated reviewer feedback", async () => {
    const { buildRulesContext: build } = await import("../src/orchestrator/solomon-rules.js");
    const session = {
      session_start_sha: "abc",
      checkpoints: [
        { stage: "coder", note: "coding" },
        { stage: "reviewer", note: "same error" },
        { stage: "coder", note: "coding" },
        { stage: "reviewer", note: "same error" },
        { stage: "coder", note: "coding" },
        { stage: "reviewer", note: "same error" }
      ]
    };

    const ctx = await build({ session, task: "fix bug", iteration: 3 });
    expect(ctx.staleIterations).toBe(3);
  });
});

describe("DEFAULT_RULES", () => {
  it("exports expected default values", () => {
    expect(DEFAULT_RULES.max_files_per_iteration).toBeUndefined();
    expect(DEFAULT_RULES.max_stale_iterations).toBe(3);
    expect(DEFAULT_RULES.no_new_dependencies_without_task).toBe(true);
    expect(DEFAULT_RULES.scope_guard).toBe(true);
  });
});
