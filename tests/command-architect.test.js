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

vi.mock("../src/prompts/architect.js", () => ({
  buildArchitectPrompt: vi.fn().mockReturnValue("architect prompt"),
  parseArchitectOutput: vi.fn().mockReturnValue({
    verdict: "ready",
    architecture: { type: "layered", layers: ["domain", "application", "infrastructure"] },
    summary: "Architecture designed"
  })
}));

function makeConfig(overrides = {}) {
  return {
    roles: { architect: { provider: "claude" } },
    ...overrides
  };
}

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn()
};

describe("commands/architect", () => {
  let createAgent, assertAgentsAvailable, buildArchitectPrompt;

  beforeEach(async () => {
    vi.resetAllMocks();

    const agents = await import("../src/agents/index.js");
    createAgent = agents.createAgent;

    const avail = await import("../src/agents/availability.js");
    assertAgentsAvailable = avail.assertAgentsAvailable;

    const prompts = await import("../src/prompts/architect.js");
    buildArchitectPrompt = prompts.buildArchitectPrompt;
    buildArchitectPrompt.mockReturnValue("architect prompt");
    prompts.parseArchitectOutput.mockReturnValue({
      verdict: "ready",
      architecture: { type: "layered", layers: ["domain", "application", "infrastructure"] },
      summary: "Architecture designed"
    });

    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: '{"verdict":"ready"}', exitCode: 0 })
    });
  });

  it("asserts architect provider is available", async () => {
    const { architectCommand } = await import("../src/commands/architect.js");
    await architectCommand({ task: "design auth system", config: makeConfig(), logger: noopLogger });

    expect(assertAgentsAvailable).toHaveBeenCalledWith(["claude"]);
  });

  it("builds prompt with task and context", async () => {
    const { architectCommand } = await import("../src/commands/architect.js");
    await architectCommand({ task: "design auth", config: makeConfig(), logger: noopLogger, context: "uses Firebase" });

    expect(buildArchitectPrompt).toHaveBeenCalledWith({ task: "design auth", researchContext: "uses Firebase" });
  });

  it("throws when architect fails", async () => {
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: false, error: "design error", exitCode: 1 })
    });

    const { architectCommand } = await import("../src/commands/architect.js");
    await expect(
      architectCommand({ task: "bad task", config: makeConfig(), logger: noopLogger })
    ).rejects.toThrow("design error");
  });

  it("outputs JSON when --json flag is set", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { architectCommand } = await import("../src/commands/architect.js");
    await architectCommand({ task: "design auth", config: makeConfig(), logger: noopLogger, json: true });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("ready"));
    spy.mockRestore();
  });
});
