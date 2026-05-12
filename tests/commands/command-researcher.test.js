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

function makeConfig(overrides = {}) {
  return {
    roles: { researcher: { provider: "claude" } },
    ...overrides
  };
}

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn()
};

describe("commands/researcher", () => {
  let createAgent, assertAgentsAvailable;

  beforeEach(async () => {
    vi.resetAllMocks();

    const agents = await import("../src/agents/index.js");
    createAgent = agents.createAgent;

    const avail = await import("../src/agents/availability.js");
    assertAgentsAvailable = avail.assertAgentsAvailable;

    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: '{"affected_files":["src/foo.js"]}', exitCode: 0 })
    });
  });

  it("asserts researcher provider is available", async () => {
    const { researcherCommand } = await import("../src/commands/researcher.js");
    await researcherCommand({ task: "investigate auth", config: makeConfig(), logger: noopLogger });

    expect(assertAgentsAvailable).toHaveBeenCalledWith(["claude"]);
  });

  it("runs task with researcher role", async () => {
    const { researcherCommand } = await import("../src/commands/researcher.js");
    await researcherCommand({ task: "investigate auth", config: makeConfig(), logger: noopLogger });

    const agent = createAgent.mock.results[0].value;
    expect(agent.runTask).toHaveBeenCalledWith(expect.objectContaining({
      role: "researcher"
    }));
  });

  it("throws when researcher fails", async () => {
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: false, error: "research error", exitCode: 1 })
    });

    const { researcherCommand } = await import("../src/commands/researcher.js");
    await expect(
      researcherCommand({ task: "bad task", config: makeConfig(), logger: noopLogger })
    ).rejects.toThrow("research error");
  });

  it("outputs result on success", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { researcherCommand } = await import("../src/commands/researcher.js");
    await researcherCommand({ task: "investigate auth", config: makeConfig(), logger: noopLogger });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("affected_files"));
    spy.mockRestore();
  });
});
