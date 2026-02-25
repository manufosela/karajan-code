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

vi.mock("../src/prompts/coder.js", () => ({
  buildCoderPrompt: vi.fn().mockReturnValue("coder prompt")
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockResolvedValue("coder rules content")
  }
}));

function makeConfig(overrides = {}) {
  return {
    roles: { coder: { provider: "codex" } },
    coder_rules: "coder-rules.md",
    development: { methodology: "tdd" },
    ...overrides
  };
}

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn()
};

describe("commands/code", () => {
  let createAgent, assertAgentsAvailable, buildCoderPrompt;

  beforeEach(async () => {
    vi.resetAllMocks();

    const agents = await import("../src/agents/index.js");
    createAgent = agents.createAgent;

    const avail = await import("../src/agents/availability.js");
    assertAgentsAvailable = avail.assertAgentsAvailable;

    const prompts = await import("../src/prompts/coder.js");
    buildCoderPrompt = prompts.buildCoderPrompt;
    buildCoderPrompt.mockReturnValue("coder prompt");

    const fs = await import("node:fs/promises");
    fs.default.readFile.mockResolvedValue("coder rules content");

    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "done", exitCode: 0 })
    });
  });

  it("asserts coder provider is available", async () => {
    const { codeCommand } = await import("../src/commands/code.js");
    await codeCommand({ task: "add feature", config: makeConfig(), logger: noopLogger });

    expect(assertAgentsAvailable).toHaveBeenCalledWith(["codex"]);
  });

  it("creates agent with resolved provider", async () => {
    const { codeCommand } = await import("../src/commands/code.js");
    const config = makeConfig();
    await codeCommand({ task: "add feature", config, logger: noopLogger });

    expect(createAgent).toHaveBeenCalledWith("codex", config, noopLogger);
  });

  it("builds coder prompt with task and rules", async () => {
    const { codeCommand } = await import("../src/commands/code.js");
    await codeCommand({ task: "add feature", config: makeConfig(), logger: noopLogger });

    expect(buildCoderPrompt).toHaveBeenCalledWith(expect.objectContaining({
      task: "add feature",
      coderRules: "coder rules content",
      methodology: "tdd"
    }));
  });

  it("runs task with prompt and onOutput callback", async () => {
    const { codeCommand } = await import("../src/commands/code.js");
    await codeCommand({ task: "add feature", config: makeConfig(), logger: noopLogger });

    const agent = createAgent.mock.results[0].value;
    expect(agent.runTask).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "coder prompt",
      role: "coder"
    }));
  });

  it("throws when coder fails", async () => {
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: false, error: "syntax error", exitCode: 1 })
    });

    const { codeCommand } = await import("../src/commands/code.js");
    await expect(
      codeCommand({ task: "bad code", config: makeConfig(), logger: noopLogger })
    ).rejects.toThrow("syntax error");
  });

  it("handles missing coder rules gracefully", async () => {
    const fs = await import("node:fs/promises");
    fs.default.readFile.mockRejectedValue(new Error("ENOENT"));

    const { codeCommand } = await import("../src/commands/code.js");
    await codeCommand({ task: "add feature", config: makeConfig(), logger: noopLogger });

    expect(buildCoderPrompt).toHaveBeenCalledWith(expect.objectContaining({
      coderRules: null
    }));
  });

  it("logs completion on success", async () => {
    const { codeCommand } = await import("../src/commands/code.js");
    await codeCommand({ task: "add feature", config: makeConfig(), logger: noopLogger });

    expect(noopLogger.info).toHaveBeenCalledWith(expect.stringContaining("completed"));
  });
});
