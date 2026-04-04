import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunTask = vi.fn();
vi.mock("../src/agents/index.js", () => ({
  createAgent: () => ({ runTask: mockRunTask, reviewTask: mockRunTask })
}));

const { KarajanBrainRole } = await import("../src/roles/karajan-brain-role.js");

describe("KarajanBrainRole", () => {
  let role;
  let logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    role = new KarajanBrainRole({
      config: { roles: { coder: { provider: "claude" } } },
      logger
    });
    role.instructions = null;
    role._initialized = true;
  });

  describe("resolveProvider", () => {
    it("uses karajan-brain.provider when configured", () => {
      role.config = { roles: { "karajan-brain": { provider: "gemini" } } };
      expect(role.resolveProvider()).toBe("gemini");
    });

    it("falls back to brain.provider", () => {
      role.config = { brain: { provider: "claude" } };
      expect(role.resolveProvider()).toBe("claude");
    });

    it("falls back to coder provider", () => {
      role.config = { roles: { coder: { provider: "codex" } } };
      expect(role.resolveProvider()).toBe("codex");
    });

    it("defaults to claude", () => {
      role.config = {};
      expect(role.resolveProvider()).toBe("claude");
    });
  });

  describe("buildPrompt", () => {
    it("includes pipeline state", async () => {
      const result = await role.buildPrompt({
        currentRole: "coder",
        roleOutput: "Generated 40 files",
        pipelineState: { iteration: 2, maxIterations: 5, filesChanged: 40 },
        availableRoles: ["reviewer", "tester"],
        task: "Build API"
      });

      expect(result.prompt).toContain("Build API");
      expect(result.prompt).toContain("Last role executed: coder");
      expect(result.prompt).toContain("Iteration: 2/5");
      expect(result.prompt).toContain("Files changed so far: 40");
      expect(result.prompt).toContain("Generated 40 files");
    });

    it("truncates long role outputs", async () => {
      const longOutput = "x".repeat(5000);
      const result = await role.buildPrompt({
        currentRole: "coder",
        roleOutput: longOutput,
        pipelineState: {},
        availableRoles: [],
        task: "test"
      });

      expect(result.prompt).toContain("truncated");
      expect(result.prompt.length).toBeLessThan(longOutput.length + 1000);
    });

    it("includes guidelines for routing decisions", async () => {
      const result = await role.buildPrompt({
        currentRole: null,
        roleOutput: null,
        pipelineState: {},
        availableRoles: [],
        task: "test"
      });

      expect(result.prompt).toContain("consultSolomon");
      expect(result.prompt).toContain("directActions");
      expect(result.prompt).toContain("nextRole");
    });
  });

  describe("buildSuccessResult", () => {
    it("parses routing decision with defaults", () => {
      const result = role.buildSuccessResult(
        { nextRole: "reviewer", reasoning: "code looks good" },
        "claude"
      );
      expect(result.nextRole).toBe("reviewer");
      expect(result.directActions).toEqual([]);
      expect(result.consultSolomon).toBe(false);
      expect(result.provider).toBe("claude");
    });

    it("handles consultSolomon flag", () => {
      const result = role.buildSuccessResult(
        {
          nextRole: "solomon",
          consultSolomon: true,
          dilemma: "security vs deadline"
        },
        "claude"
      );
      expect(result.consultSolomon).toBe(true);
      expect(result.dilemma).toBe("security vs deadline");
    });

    it("preserves direct actions array", () => {
      const result = role.buildSuccessResult(
        {
          nextRole: "coder",
          directActions: [
            { type: "run_command", params: { cmd: "npm install" } }
          ]
        },
        "claude"
      );
      expect(result.directActions).toHaveLength(1);
      expect(result.directActions[0].type).toBe("run_command");
    });
  });

  describe("handleParseNull", () => {
    it("falls back to default flow", () => {
      const result = role.handleParseNull({ output: "garbage", usage: {} }, "claude");
      expect(result.ok).toBe(true);
      expect(result.result.nextRole).toBe("coder");
      expect(result.result.consultSolomon).toBe(false);
    });
  });

  describe("buildSummary", () => {
    it("includes next role and action count", () => {
      const summary = role.buildSummary({
        nextRole: "reviewer",
        directActions: [{}, {}]
      });
      expect(summary).toContain("next=reviewer");
      expect(summary).toContain("2 direct action(s)");
    });

    it("notes solomon consultation", () => {
      const summary = role.buildSummary({
        nextRole: "solomon",
        consultSolomon: true,
        directActions: []
      });
      expect(summary).toContain("consulting Solomon");
    });
  });
});
