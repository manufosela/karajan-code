import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue("")
}));

const {
  createBrainContext, isBrainEnabled, processRoleOutput,
  buildCoderFeedbackPrompt, verifyCoderRan, clearFeedback, summarize
} = await import("../src/orchestrator/brain-coordinator.js");

describe("brain-coordinator", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("createBrainContext", () => {
    it("creates disabled context by default", () => {
      const ctx = createBrainContext();
      expect(ctx.enabled).toBe(false);
      expect(ctx.feedbackQueue.entries).toEqual([]);
    });

    it("creates enabled context when flag set", () => {
      const ctx = createBrainContext({ enabled: true });
      expect(ctx.enabled).toBe(true);
    });
  });

  describe("isBrainEnabled", () => {
    it("returns true when brain.enabled is true", () => {
      expect(isBrainEnabled({ brain: { enabled: true } })).toBe(true);
    });

    it("returns true when pipeline.brain.enabled is true", () => {
      expect(isBrainEnabled({ pipeline: { brain: { enabled: true } } })).toBe(true);
    });

    it("returns false otherwise", () => {
      expect(isBrainEnabled({})).toBe(false);
      expect(isBrainEnabled(null)).toBe(false);
    });
  });

  describe("processRoleOutput", () => {
    it("returns output unchanged when brain disabled", () => {
      const ctx = createBrainContext({ enabled: false });
      const output = { data: "test" };
      const result = processRoleOutput(ctx, { roleName: "reviewer", output });
      expect(result).toBe(output);
    });

    it("compresses output when brain enabled", () => {
      const ctx = createBrainContext({ enabled: true });
      const output = {
        blocking_issues: [
          { severity: "high", description: "missing auth", file: "app.js", line: 10 }
        ]
      };
      const result = processRoleOutput(ctx, { roleName: "reviewer", output, iteration: 1 });
      expect(typeof result).toBe("string");
      expect(result).toContain("missing auth");
    });

    it("extracts reviewer feedback into queue", () => {
      const ctx = createBrainContext({ enabled: true });
      const output = {
        blocking_issues: [
          { severity: "high", description: "SQL injection vulnerability", file: "db.js" }
        ]
      };
      processRoleOutput(ctx, { roleName: "reviewer", output, iteration: 1 });
      expect(ctx.feedbackQueue.entries).toHaveLength(1);
      expect(ctx.feedbackQueue.entries[0].source).toBe("reviewer");
      expect(ctx.feedbackQueue.entries[0].category).toBe("security");
    });

    it("extracts tester failures into queue", () => {
      const ctx = createBrainContext({ enabled: true });
      const output = {
        verdict: "fail",
        missing_scenarios: ["edge case 1", "edge case 2"],
        coverage: { overall: 60 }
      };
      processRoleOutput(ctx, { roleName: "tester", output, iteration: 1 });
      expect(ctx.feedbackQueue.entries.length).toBeGreaterThanOrEqual(3);
      expect(ctx.feedbackQueue.entries.some(e => e.description.includes("Coverage below"))).toBe(true);
    });

    it("extracts security vulnerabilities into queue", () => {
      const ctx = createBrainContext({ enabled: true });
      const output = {
        verdict: "fail",
        vulnerabilities: [
          { severity: "critical", description: "SQL injection", file: "api.js" }
        ]
      };
      processRoleOutput(ctx, { roleName: "security", output, iteration: 1 });
      expect(ctx.feedbackQueue.entries[0].source).toBe("security");
      expect(ctx.feedbackQueue.entries[0].severity).toBe("critical");
    });

    it("tracks compression stats", () => {
      const ctx = createBrainContext({ enabled: true });
      const output = { affected_files: ["a.js", "b.js"], patterns: ["MVC"] };
      processRoleOutput(ctx, { roleName: "researcher", output });
      expect(ctx.compressionStats.perRole.researcher).toBeDefined();
    });
  });

  describe("buildCoderFeedbackPrompt", () => {
    it("returns null when disabled", () => {
      const ctx = createBrainContext({ enabled: false });
      expect(buildCoderFeedbackPrompt(ctx)).toBe(null);
    });

    it("returns null when queue empty", () => {
      const ctx = createBrainContext({ enabled: true });
      expect(buildCoderFeedbackPrompt(ctx)).toBe(null);
    });

    it("formats enriched feedback for coder", () => {
      const ctx = createBrainContext({ enabled: true });
      processRoleOutput(ctx, {
        roleName: "reviewer",
        output: {
          blocking_issues: [
            { severity: "high", description: "missing CSRF in app.js", file: "app.js" }
          ]
        },
        iteration: 1
      });
      const prompt = buildCoderFeedbackPrompt(ctx);
      expect(prompt).toContain("Issue 1");
      expect(prompt).toContain("Action plan");
    });
  });

  describe("verifyCoderRan", () => {
    it("returns passed when disabled", () => {
      const ctx = createBrainContext({ enabled: false });
      const result = verifyCoderRan(ctx, { baseRef: "HEAD~1" });
      expect(result.passed).toBe(true);
    });

    it("tracks verification in enabled mode", () => {
      const ctx = createBrainContext({ enabled: true });
      verifyCoderRan(ctx, { baseRef: "HEAD~1" });
      expect(ctx.verificationTracker.history.length).toBe(1);
    });
  });

  describe("clearFeedback", () => {
    it("empties the queue", () => {
      const ctx = createBrainContext({ enabled: true });
      processRoleOutput(ctx, {
        roleName: "reviewer",
        output: { blocking_issues: [{ description: "x" }] },
        iteration: 1
      });
      clearFeedback(ctx);
      expect(ctx.feedbackQueue.entries).toEqual([]);
    });
  });

  describe("summarize", () => {
    it("returns null when disabled", () => {
      expect(summarize(createBrainContext({ enabled: false }))).toBe(null);
    });

    it("returns activity summary when enabled", () => {
      const ctx = createBrainContext({ enabled: true });
      processRoleOutput(ctx, {
        roleName: "reviewer",
        output: { blocking_issues: [{ description: "test", severity: "high" }] },
        iteration: 1
      });
      const sum = summarize(ctx);
      expect(sum.feedbackQueueSize).toBe(1);
      expect(sum.compressionSaved).toBeGreaterThanOrEqual(0);
    });
  });
});
