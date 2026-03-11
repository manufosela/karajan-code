import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscoverRole } from "../src/roles/discover-role.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn() };
}

function makeConfig(overrides = {}) {
  return {
    roles: {
      discover: { provider: "claude", model: null },
      coder: { provider: "claude", model: null },
      ...overrides.roles
    },
    pipeline: {
      discover: { enabled: true },
      ...overrides.pipeline
    }
  };
}

function makeMockAgent(output) {
  return {
    runTask: vi.fn().mockResolvedValue(output)
  };
}

describe("DiscoverRole", () => {
  let logger;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("extends BaseRole with name 'discover'", () => {
    const role = new DiscoverRole({ config: makeConfig(), logger });
    expect(role.name).toBe("discover");
  });

  describe("execute() — gaps mode", () => {
    it("returns verdict=ready when no gaps found", async () => {
      const agentOutput = JSON.stringify({
        verdict: "ready",
        gaps: [],
        summary: "Task is well defined"
      });
      const mockAgent = makeMockAgent({ ok: true, output: agentOutput });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "Add login page" });
      const result = await role.run({ task: "Add login page" });

      expect(result.ok).toBe(true);
      expect(result.result.verdict).toBe("ready");
      expect(result.result.gaps).toEqual([]);
    });

    it("returns verdict=needs_validation with gaps when found", async () => {
      const agentOutput = JSON.stringify({
        verdict: "needs_validation",
        gaps: [
          { id: "gap-1", description: "Missing auth spec", severity: "critical", suggestedQuestion: "Which auth provider?" },
          { id: "gap-2", description: "No error handling spec", severity: "minor", suggestedQuestion: "What on failure?" }
        ],
        summary: "2 gaps found"
      });
      const mockAgent = makeMockAgent({ ok: true, output: agentOutput });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "Implement auth system" });
      const result = await role.run({ task: "Implement auth system" });

      expect(result.ok).toBe(true);
      expect(result.result.verdict).toBe("needs_validation");
      expect(result.result.gaps).toHaveLength(2);
      expect(result.result.gaps[0].id).toBe("gap-1");
      expect(result.result.gaps[0].severity).toBe("critical");
      expect(result.result.gaps[1].severity).toBe("minor");
    });

    it("handles agent failure gracefully", async () => {
      const mockAgent = makeMockAgent({ ok: false, error: "Agent crashed" });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "x" });
      const result = await role.run({ task: "x" });

      expect(result.ok).toBe(false);
      expect(result.result.error).toContain("crashed");
    });

    it("handles unstructured (non-JSON) output gracefully", async () => {
      const mockAgent = makeMockAgent({ ok: true, output: "I found some issues but no JSON" });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "x" });
      const result = await role.run({ task: "x" });

      expect(result.ok).toBe(true);
      expect(result.result.verdict).toBe("ready");
      expect(result.result.gaps).toEqual([]);
      expect(result.result.raw).toBeDefined();
    });

    it("handles malformed JSON gracefully", async () => {
      const mockAgent = makeMockAgent({ ok: true, output: "{not valid json at all}" });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "x" });
      const result = await role.run({ task: "x" });

      expect(result.ok).toBe(true);
      expect(result.result.verdict).toBe("ready");
      expect(result.result.gaps).toEqual([]);
      expect(result.result.raw).toBeDefined();
    });

    it("passes onOutput callback to agent", async () => {
      const mockAgent = makeMockAgent({ ok: true, output: JSON.stringify({ verdict: "ready", gaps: [] }) });
      const createAgentFn = () => mockAgent;
      const onOutput = vi.fn();

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "x" });
      await role.run({ task: "x", onOutput });

      const runArgs = mockAgent.runTask.mock.calls[0][0];
      expect(runArgs.onOutput).toBe(onOutput);
    });

    it("uses discover provider from config", async () => {
      const config = makeConfig({ roles: { discover: { provider: "gemini", model: null }, coder: { provider: "claude", model: null } } });
      const mockAgent = makeMockAgent({ ok: true, output: JSON.stringify({ verdict: "ready", gaps: [] }) });
      const createAgentFn = vi.fn().mockReturnValue(mockAgent);

      const role = new DiscoverRole({ config, logger, createAgentFn });
      await role.init({ task: "x" });
      await role.run({ task: "x" });

      expect(createAgentFn).toHaveBeenCalledWith("gemini", config, logger);
    });

    it("falls back to coder provider if discover provider not set", async () => {
      const config = makeConfig({ roles: { discover: { provider: null, model: null }, coder: { provider: "aider", model: null } } });
      const mockAgent = makeMockAgent({ ok: true, output: JSON.stringify({ verdict: "ready", gaps: [] }) });
      const createAgentFn = vi.fn().mockReturnValue(mockAgent);

      const role = new DiscoverRole({ config, logger, createAgentFn });
      await role.init({ task: "x" });
      await role.run({ task: "x" });

      expect(createAgentFn).toHaveBeenCalledWith("aider", config, logger);
    });

    it("includes mode in result", async () => {
      const mockAgent = makeMockAgent({ ok: true, output: JSON.stringify({ verdict: "ready", gaps: [] }) });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "x" });
      const result = await role.run({ task: "x", mode: "gaps" });

      expect(result.result.mode).toBe("gaps");
    });

    it("defaults mode to gaps", async () => {
      const mockAgent = makeMockAgent({ ok: true, output: JSON.stringify({ verdict: "ready", gaps: [] }) });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "x" });
      const result = await role.run({ task: "x" });

      expect(result.result.mode).toBe("gaps");
    });

    it("includes provider in result", async () => {
      const mockAgent = makeMockAgent({ ok: true, output: JSON.stringify({ verdict: "ready", gaps: [] }) });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "x" });
      const result = await role.run({ task: "x" });

      expect(result.result.provider).toBe("claude");
    });

    it("builds summary with gap count", async () => {
      const agentOutput = JSON.stringify({
        verdict: "needs_validation",
        gaps: [
          { id: "g1", description: "Missing spec", severity: "critical", suggestedQuestion: "q" },
          { id: "g2", description: "Unclear scope", severity: "major", suggestedQuestion: "q" }
        ]
      });
      const mockAgent = makeMockAgent({ ok: true, output: agentOutput });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "x" });
      const result = await role.run({ task: "x" });

      expect(result.summary).toContain("2");
      expect(result.summary).toContain("gap");
    });

    it("accepts task as string input", async () => {
      const mockAgent = makeMockAgent({ ok: true, output: JSON.stringify({ verdict: "ready", gaps: [] }) });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "test task" });
      const result = await role.run("test task");

      expect(result.ok).toBe(true);
    });

    it("uses context task as fallback", async () => {
      const mockAgent = makeMockAgent({ ok: true, output: JSON.stringify({ verdict: "ready", gaps: [] }) });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "context task" });
      const result = await role.run({});

      expect(result.ok).toBe(true);
      const prompt = mockAgent.runTask.mock.calls[0][0].prompt;
      expect(prompt).toContain("context task");
    });

    it("returns momTestQuestions in momtest mode", async () => {
      const agentOutput = JSON.stringify({
        verdict: "needs_validation",
        gaps: [{ id: "g1", description: "Missing auth", severity: "critical", suggestedQuestion: "q" }],
        momTestQuestions: [
          { gapId: "g1", question: "When was the last time you had to log in?", targetRole: "end-user", rationale: "Validates auth need" }
        ]
      });
      const mockAgent = makeMockAgent({ ok: true, output: agentOutput });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "Add auth" });
      const result = await role.run({ task: "Add auth", mode: "momtest" });

      expect(result.ok).toBe(true);
      expect(result.result.mode).toBe("momtest");
      expect(result.result.momTestQuestions).toHaveLength(1);
      expect(result.result.momTestQuestions[0].gapId).toBe("g1");
      expect(result.result.momTestQuestions[0].targetRole).toBe("end-user");
    });

    it("returns empty momTestQuestions when verdict is ready in momtest mode", async () => {
      const agentOutput = JSON.stringify({ verdict: "ready", gaps: [] });
      const mockAgent = makeMockAgent({ ok: true, output: agentOutput });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "x" });
      const result = await role.run({ task: "x", mode: "momtest" });

      expect(result.result.momTestQuestions).toEqual([]);
    });

    it("includes momTestQuestions count in summary for momtest mode", async () => {
      const agentOutput = JSON.stringify({
        verdict: "needs_validation",
        gaps: [{ id: "g1", description: "x", severity: "major", suggestedQuestion: "q" }],
        momTestQuestions: [
          { gapId: "g1", question: "q1", targetRole: "dev", rationale: "r" },
          { gapId: "g1", question: "q2", targetRole: "pm", rationale: "r" }
        ]
      });
      const mockAgent = makeMockAgent({ ok: true, output: agentOutput });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "x" });
      const result = await role.run({ task: "x", mode: "momtest" });

      expect(result.summary).toContain("2");
      expect(result.summary).toMatch(/question/i);
    });

    it("forwards usage from agent result", async () => {
      const mockAgent = makeMockAgent({
        ok: true,
        output: JSON.stringify({ verdict: "ready", gaps: [] }),
        usage: { input_tokens: 100, output_tokens: 50 }
      });
      const createAgentFn = () => mockAgent;

      const role = new DiscoverRole({ config: makeConfig(), logger, createAgentFn });
      await role.init({ task: "x" });
      const result = await role.run({ task: "x" });

      expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
    });
  });
});
