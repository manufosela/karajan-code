import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { createNoopLoggerWithContext } from "../_fixtures/loggers.js";

vi.mock("../../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../../src/agents/availability.js", () => ({
  assertAgentsAvailable: vi.fn()
}));

vi.mock("../../src/config.js", () => ({
  resolveRole: vi.fn((config, role) => ({
    provider: config.roles?.[role]?.provider || role
  }))
}));

vi.mock("../../src/prompts/coder.js", () => ({
  buildCoderPrompt: vi.fn().mockReturnValue("coder prompt"),
  buildCoderPromptLayout: async () => ({ stable: "coder prompt", volatile: "" })
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockResolvedValue("coder rules content")
  }
}));

function makeConfig(overrides = {}) {
  return {
    roles: { coder: { provider: "codex" } },
    coder_rules: ".karajan/coder-rules.md",
    development: { methodology: "tdd" },
    ...overrides
  };
}

const noopLogger = createNoopLoggerWithContext();
// The run log writes inside projectDir, so a real directory it is.
let repo;

describe("commands/code", () => {
  let createAgent, assertAgentsAvailable, buildCoderPrompt;

  const codeCommandWith = async (overrides) => {
    const { codeCommand } = await import("../../src/commands/code.js");
    return codeCommand({ task: "add feature", config: makeConfig(overrides), logger: noopLogger });
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    repo = mkdtempSync(join(tmpdir(), "kj-code-"));

    const agents = await import("../../src/agents/index.js");
    createAgent = agents.createAgent;

    const avail = await import("../../src/agents/availability.js");
    assertAgentsAvailable = avail.assertAgentsAvailable;

    const prompts = await import("../../src/prompts/coder.js");
    buildCoderPrompt = prompts.buildCoderPrompt;
    buildCoderPrompt.mockReturnValue("coder prompt");

    const fs = await import("node:fs/promises");
    fs.default.readFile.mockResolvedValue("coder rules content");

    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "done", exitCode: 0 })
    });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("asserts coder provider is available", async () => {
    const { codeCommand } = await import("../../src/commands/code.js");
    await codeCommand({ task: "add feature", config: makeConfig(), logger: noopLogger });

    expect(assertAgentsAvailable).toHaveBeenCalledWith(["codex"]);
  });

  it("creates agent with resolved provider", async () => {
    const { codeCommand } = await import("../../src/commands/code.js");
    const config = makeConfig();
    await codeCommand({ task: "add feature", config, logger: noopLogger });

    expect(createAgent).toHaveBeenCalledWith("codex", config, noopLogger);
  });

  it("builds coder prompt with task and rules", async () => {
    const { codeCommand } = await import("../../src/commands/code.js");
    await codeCommand({ task: "add feature", config: makeConfig(), logger: noopLogger });

    expect(buildCoderPrompt).toHaveBeenCalledWith(expect.objectContaining({
      task: "add feature",
      coderRules: "coder rules content",
      methodology: "tdd"
    }));
  });

  it("runs task with prompt and onOutput callback", async () => {
    const { codeCommand } = await import("../../src/commands/code.js");
    await codeCommand({ task: "add feature", config: makeConfig(), logger: noopLogger });

    const agent = createAgent.mock.results[0].value;
    expect(agent.runTask).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "coder prompt",
      role: "coder"
    }));
  });

  // KJC-TSK-0864: the pipeline always passed the project boundary and the
  // provider; the session did not, so the SAME agent got a weaker prompt from
  // kj code than from kj run.
  it("passes the project boundary and the provider, as the pipeline does", async () => {
    const { codeCommand } = await import("../../src/commands/code.js");
    await codeCommand({ task: "add feature", config: makeConfig({ projectDir: repo }), logger: noopLogger });

    expect(buildCoderPrompt).toHaveBeenCalledWith(expect.objectContaining({
      projectDir: repo,
      provider: "codex"
    }));
  });

  it("a card reference reaches the coder as statement plus criteria", async () => {
    const { codeCommand } = await import("../../src/commands/code.js");
    const res = await codeCommand({
      task: "add feature",
      config: makeConfig({ projectDir: repo }),
      logger: noopLogger,
      flags: { card: "KJC-TSK-0864" },
    });

    const args = buildCoderPrompt.mock.calls.at(-1)[0];
    expect(args.huId).toBe("KJC-TSK-0864");
    expect(args.task).toContain("## Card KJC-TSK-0864");
    expect(args.task).toContain("add feature");
    expect(res.card).toBe("KJC-TSK-0864");
  });

  it("points at the review gate and names who must NOT run it", async () => {
    const { codeCommand } = await import("../../src/commands/code.js");
    await codeCommand({ task: "add feature", config: makeConfig(), logger: noopLogger });

    const said = noopLogger.info.mock.calls.map((c) => String(c[0])).join("\n");
    expect(said).toContain("kj review --staged");
    expect(said).toContain("different AI than codex");
  });

  // KJC-TSK-0859: los agentes ya no sustituyen un modelo muerto por su cuenta
  // (lo hacian en silencio y por delante de lo declarado). kj code pasa ahora
  // por el brain con la cadena del usuario, asi que no pierde la red.
  it("un modelo muerto pasa al siguiente eslabon declarado en vez de parar el trabajo", async () => {
    const dead = { runTask: vi.fn().mockResolvedValue({ ok: false, error: "model gpt-5.4 is not supported", exitCode: 1 }) };
    const alive = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "done", exitCode: 0 }) };
    createAgent.mockImplementation((_provider, config) => (config?.roles?.coder?.model === "gpt-5.4" ? dead : alive));

    const res = await codeCommandWith({
      projectDir: repo,
      roles: { coder: { provider: "codex", model: "gpt-5.4", fallback: { provider: "codex", model: "gpt-5.6-terra" } } },
    });

    expect(res.ok).toBe(true);
    expect(dead.runTask).toHaveBeenCalledTimes(1);
    expect(alive.runTask).toHaveBeenCalledTimes(1);
  });

  it("sin eslabon que tomar, para diciendo que se probo", async () => {
    const dead = { runTask: vi.fn().mockResolvedValue({ ok: false, error: "model gpt-5.4 is not supported", exitCode: 1 }) };
    createAgent.mockReturnValue(dead);

    await expect(codeCommandWith({
      projectDir: repo,
      roles: { coder: { provider: "codex", model: "gpt-5.4" } },
    })).rejects.toThrow(/not supported|MODEL_UNAVAILABLE/);
  });

  it("throws when coder fails", async () => {
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: false, error: "syntax error", exitCode: 1 })
    });

    const { codeCommand } = await import("../../src/commands/code.js");
    await expect(
      codeCommand({ task: "bad code", config: makeConfig(), logger: noopLogger })
    ).rejects.toThrow("syntax error");
  });

  it("handles missing coder rules gracefully", async () => {
    const fs = await import("node:fs/promises");
    fs.default.readFile.mockRejectedValue(new Error("ENOENT"));

    const { codeCommand } = await import("../../src/commands/code.js");
    await codeCommand({ task: "add feature", config: makeConfig(), logger: noopLogger });

    expect(buildCoderPrompt).toHaveBeenCalledWith(expect.objectContaining({
      coderRules: null
    }));
  });

  it("logs completion on success", async () => {
    const { codeCommand } = await import("../../src/commands/code.js");
    await codeCommand({ task: "add feature", config: makeConfig(), logger: noopLogger });

    expect(noopLogger.info).toHaveBeenCalledWith(expect.stringContaining("completed"));
  });
});
