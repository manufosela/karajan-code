import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/agents/availability.js", () => ({
  assertAgentsAvailable: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  resolveRole: vi.fn((config, role) => ({
    provider: config.roles?.[role]?.provider || "claude"
  }))
}));

vi.mock("../src/prompts/planner.js", () => ({
  buildPlannerPrompt: vi.fn().mockReturnValue("planner prompt")
}));

function makeConfig(overrides = {}) {
  return {
    roles: { planner: { provider: "claude" } },
    session: { max_iteration_minutes: 10 },
    ...overrides
  };
}

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn()
};

const validPlan = JSON.stringify({
  approach: "Use modular design",
  steps: [
    { description: "Create database schema", commit: "feat: add user schema" },
    { description: "Add API endpoints", commit: "feat: add auth endpoints" }
  ],
  risks: ["Token expiration handling"],
  outOfScope: ["OAuth2 support"]
});

describe("commands/plan", () => {
  let createAgent, assertAgentsAvailable, buildPlannerPrompt;

  beforeEach(async () => {
    vi.resetAllMocks();

    const agents = await import("../src/agents/index.js");
    createAgent = agents.createAgent;

    const avail = await import("../src/agents/availability.js");
    assertAgentsAvailable = avail.assertAgentsAvailable;

    const prompts = await import("../src/prompts/planner.js");
    buildPlannerPrompt = prompts.buildPlannerPrompt;
    buildPlannerPrompt.mockReturnValue("planner prompt");

    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: validPlan, exitCode: 0 })
    });
  });

  it("asserts planner agent is available", async () => {
    const { planCommand } = await import("../src/commands/plan.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await planCommand({ task: "Add auth", config: makeConfig(), logger: noopLogger });
    consoleSpy.mockRestore();

    expect(assertAgentsAvailable).toHaveBeenCalledWith(["claude"]);
  });

  it("builds planner prompt with task", async () => {
    const { planCommand } = await import("../src/commands/plan.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await planCommand({ task: "Add auth", config: makeConfig(), logger: noopLogger });
    consoleSpy.mockRestore();

    expect(buildPlannerPrompt).toHaveBeenCalledWith(expect.objectContaining({
      task: "Add auth"
    }));
  });

  it("calls agent runTask with prompt and planner role", async () => {
    const { planCommand } = await import("../src/commands/plan.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await planCommand({ task: "Add auth", config: makeConfig(), logger: noopLogger });
    consoleSpy.mockRestore();

    const agent = createAgent.mock.results[0].value;
    expect(agent.runTask).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "planner prompt",
      role: "planner"
    }));
  });

  it("prints formatted plan on success", async () => {
    const { planCommand } = await import("../src/commands/plan.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await planCommand({ task: "Add auth", config: makeConfig(), logger: noopLogger });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("modular design");
    expect(output).toContain("database schema");
    consoleSpy.mockRestore();
  });

  it("outputs raw JSON in json mode", async () => {
    const { planCommand } = await import("../src/commands/plan.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await planCommand({ task: "Add auth", config: makeConfig(), logger: noopLogger, json: true });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain('"approach"');
    consoleSpy.mockRestore();
  });

  it("throws when planner agent fails", async () => {
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: false, error: "planner crashed", exitCode: 1 })
    });

    const { planCommand } = await import("../src/commands/plan.js");
    await expect(
      planCommand({ task: "Bad plan", config: makeConfig(), logger: noopLogger })
    ).rejects.toThrow("planner crashed");
  });

  it("handles non-JSON output gracefully", async () => {
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "Plain text plan:\n1. Do this\n2. Do that", exitCode: 0 })
    });

    const { planCommand } = await import("../src/commands/plan.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await planCommand({ task: "Add feature", config: makeConfig(), logger: noopLogger });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Do this");
    consoleSpy.mockRestore();
  });
});
