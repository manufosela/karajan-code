// KJC-TSK-0665 — Qwen Code as sixth built-in agent: a gemini-cli fork that
// inherits the stdin prompt contract (KJC-BUG-0121) with its own binary and
// no gemini-specific trust env.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QwenAgent } from "../../src/agents/qwen-agent.js";
import { createAgent, getAgentMeta } from "../../src/agents/index.js";
import { buildMockEnvironment } from "../../src/infrastructure/mocks.js";

describe("QwenAgent", () => {
  let runCommand, env;
  beforeEach(() => {
    env = buildMockEnvironment();
    runCommand = vi.spyOn(env.runner, "run").mockResolvedValue({ exitCode: 0, stdout: "{}", stderr: "" });
  });

  it("is registered as a built-in agent with the qwen binary", () => {
    expect(getAgentMeta("qwen")).toMatchObject({ bin: "qwen" });
    expect(createAgent("qwen", {}, {}, env)).toBeInstanceOf(QwenAgent);
  });

  it("spawns `qwen` with the prompt on stdin, never as an argument", async () => {
    const agent = new QwenAgent("qwen", {}, {}, env);
    await agent.reviewTask({ prompt: "arbitrate this diff", role: "solomon" });
    const [bin, args, opts] = runCommand.mock.calls[0];
    expect(bin).toMatch(/qwen/);
    expect(args).toEqual(["--output-format", "json"]);
    expect(args).not.toContain("arbitrate this diff");
    expect(opts.input).toBe("arbitrate this diff");
  });

  it("actively removes gemini's trust env from the qwen spawn (execa merge semantics)", async () => {
    const agent = new QwenAgent("qwen", {}, {}, env);
    await agent.runTask({ prompt: "x", role: "coder" });
    const spawnEnv = runCommand.mock.calls[0][2].env;
    expect(spawnEnv).toHaveProperty("GEMINI_CLI_TRUST_WORKSPACE", undefined);
  });

  it("solomon can pick qwen as third party (claude brain, codex reviewer)", async () => {
    const { pickThirdParty } = await import("../../src/review/solomon-arbitration.js");
    const detectAgents = async () => [
      { name: "claude", available: true }, { name: "codex", available: true }, { name: "qwen", available: true },
    ];
    expect(await pickThirdParty({ config: {}, hostAgent: "claude", reviewerAgent: "codex", detectAgents })).toBe("qwen");
  });
});
