import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/agents/availability.js", () => ({
  assertAgentsAvailable: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  resolveRole: vi.fn((config, role) => ({
    provider: config.roles?.[role]?.provider || role
  }))
}));

vi.mock("../src/prompts/triage.js", () => ({
  buildTriagePrompt: vi.fn().mockReturnValue("triage prompt")
}));

vi.mock("../src/review/parser.js", () => ({
  parseMaybeJsonString: vi.fn().mockReturnValue({
    level: "medium",
    taskType: "sw",
    roles: ["reviewer", "tester"],
    reasoning: "Moderate complexity task"
  })
}));

function makeConfig(overrides = {}) {
  return {
    roles: { triage: { provider: "claude" } },
    ...overrides
  };
}

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn()
};

describe("commands/triage", () => {
  let createAgent, assertAgentsAvailable;

  beforeEach(async () => {
    vi.resetAllMocks();

    const agents = await import("../src/agents/index.js");
    createAgent = agents.createAgent;

    const avail = await import("../src/agents/availability.js");
    assertAgentsAvailable = avail.assertAgentsAvailable;

    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: '{"level":"medium"}', exitCode: 0 })
    });
  });

  it("asserts triage provider is available", async () => {
    const { triageCommand } = await import("../src/commands/triage.js");
    await triageCommand({ task: "add feature", config: makeConfig(), logger: noopLogger });

    expect(assertAgentsAvailable).toHaveBeenCalledWith(["claude"]);
  });

  it("throws when triage fails", async () => {
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: false, error: "triage error", exitCode: 1 })
    });

    const { triageCommand } = await import("../src/commands/triage.js");
    await expect(
      triageCommand({ task: "bad task", config: makeConfig(), logger: noopLogger })
    ).rejects.toThrow("triage error");
  });

  it("outputs JSON when --json flag is set", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { triageCommand } = await import("../src/commands/triage.js");
    await triageCommand({ task: "add feature", config: makeConfig(), logger: noopLogger, json: true });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("medium"));
    spy.mockRestore();
  });
});
