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

vi.mock("../src/prompts/discover.js", () => ({
  buildDiscoverPrompt: vi.fn().mockReturnValue("discover prompt"),
  parseDiscoverOutput: vi.fn().mockReturnValue({
    verdict: "needs_validation",
    gaps: [{ description: "Missing DB schema", severity: "high" }],
    summary: "1 gap found"
  })
}));

function makeConfig(overrides = {}) {
  return {
    roles: { discover: { provider: "claude" } },
    ...overrides
  };
}

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn()
};

describe("commands/discover", () => {
  let createAgent, assertAgentsAvailable, buildDiscoverPrompt;

  beforeEach(async () => {
    vi.resetAllMocks();

    const agents = await import("../src/agents/index.js");
    createAgent = agents.createAgent;

    const avail = await import("../src/agents/availability.js");
    assertAgentsAvailable = avail.assertAgentsAvailable;

    const prompts = await import("../src/prompts/discover.js");
    buildDiscoverPrompt = prompts.buildDiscoverPrompt;
    buildDiscoverPrompt.mockReturnValue("discover prompt");
    prompts.parseDiscoverOutput.mockReturnValue({
      verdict: "needs_validation",
      gaps: [{ description: "Missing DB schema", severity: "high" }],
      summary: "1 gap found"
    });

    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: '{"verdict":"needs_validation"}', exitCode: 0 })
    });
  });

  it("asserts discover provider is available", async () => {
    const { discoverCommand } = await import("../src/commands/discover.js");
    await discoverCommand({ task: "add login", config: makeConfig(), logger: noopLogger, mode: "gaps" });

    expect(assertAgentsAvailable).toHaveBeenCalledWith(["claude"]);
  });

  it("builds prompt with task and mode", async () => {
    const { discoverCommand } = await import("../src/commands/discover.js");
    await discoverCommand({ task: "add login", config: makeConfig(), logger: noopLogger, mode: "momtest" });

    expect(buildDiscoverPrompt).toHaveBeenCalledWith({ task: "add login", mode: "momtest" });
  });

  it("defaults mode to gaps", async () => {
    const { discoverCommand } = await import("../src/commands/discover.js");
    await discoverCommand({ task: "add login", config: makeConfig(), logger: noopLogger });

    expect(buildDiscoverPrompt).toHaveBeenCalledWith({ task: "add login", mode: "gaps" });
  });

  it("throws when discover fails", async () => {
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: false, error: "agent error", exitCode: 1 })
    });

    const { discoverCommand } = await import("../src/commands/discover.js");
    await expect(
      discoverCommand({ task: "bad task", config: makeConfig(), logger: noopLogger })
    ).rejects.toThrow("agent error");
  });

  it("outputs JSON when --json flag is set", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { discoverCommand } = await import("../src/commands/discover.js");
    await discoverCommand({ task: "add login", config: makeConfig(), logger: noopLogger, json: true });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("needs_validation"));
    spy.mockRestore();
  });
});
