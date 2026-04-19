/**
 * Unit tests demonstrating the DI migration for agent adapters.
 * Every test here replaces execa (via MockCommandRunner) so the suite runs
 * without spawning real subprocesses — the motivation for TSK-0316.
 */
import { describe, expect, it } from "vitest";
import { BaseAgent } from "../../src/agents/base-agent.js";
import { ClaudeAgent } from "../../src/agents/claude-agent.js";
import { CodexAgent } from "../../src/agents/codex-agent.js";
import { GeminiAgent } from "../../src/agents/gemini-agent.js";
import { AiderAgent } from "../../src/agents/aider-agent.js";
import { OpenCodeAgent } from "../../src/agents/opencode-agent.js";
import { createAgent } from "../../src/agents/index.js";
import { buildMockEnvironment } from "../../src/infrastructure/mocks.js";
import { defaultEnvironment } from "../../src/infrastructure/environment.js";

const silentLogger = { info() {}, warn() {}, error() {} };

function makeAgent(Agent, environment) {
  return new Agent(Agent.name.toLowerCase(), { roles: {} }, silentLogger, environment);
}

describe("BaseAgent — DI surface", () => {
  it("falls back to the default environment when none is injected", () => {
    const agent = new BaseAgent("x", {}, silentLogger);
    expect(agent.environment).toBe(defaultEnvironment);
  });

  it("routes runCommand() through the injected runner", async () => {
    const { env, runner } = buildMockEnvironment();
    runner.enqueue({ stdout: "delegated", exitCode: 0 });
    const agent = new BaseAgent("x", {}, silentLogger, env);

    const res = await agent.runCommand("hello", ["world"], { cwd: "/tmp" });

    expect(res.stdout).toBe("delegated");
    expect(runner.lastCall).toMatchObject({
      command: "hello",
      args: ["world"]
    });
    expect(runner.lastCall.options.cwd).toBe("/tmp");
  });
});

describe("createAgent() — threads environment to concrete agents", () => {
  it("passes a custom environment down to the instantiated agent", () => {
    const { env } = buildMockEnvironment();
    const agent = createAgent("claude", { roles: {} }, silentLogger, env);
    expect(agent.environment).toBe(env);
  });

  it("uses the default environment when none is supplied", () => {
    const agent = createAgent("claude", { roles: {} }, silentLogger);
    expect(agent.environment).toBe(defaultEnvironment);
  });
});

describe("ClaudeAgent — runTask with MockCommandRunner", () => {
  it("parses a successful stream-json result without touching execa", async () => {
    const { env, runner } = buildMockEnvironment();
    const streamJson = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hello world" }] } }),
      JSON.stringify({
        type: "result",
        result: "Hello world",
        usage: { input_tokens: 10, output_tokens: 5 },
        total_cost_usd: 0.0012,
        modelUsage: { "claude-sonnet": {} }
      })
    ].join("\n");
    runner.enqueue({ exitCode: 0, stdout: streamJson, stderr: "" });

    const agent = makeAgent(ClaudeAgent, env);
    const res = await agent.runTask({ prompt: "ping", onOutput: () => {}, role: "coder" });

    expect(res.ok).toBe(true);
    expect(res.output).toBe("Hello world");
    expect(res.tokens_in).toBe(10);
    expect(res.tokens_out).toBe(5);
    expect(res.cost_usd).toBeCloseTo(0.0012, 6);
    expect(res.model).toBe("claude-sonnet");
    expect(runner.lastCall.command).toMatch(/claude/);
    expect(runner.lastCall.args).toContain("-p");
    expect(runner.lastCall.args).toContain("ping");
  });

  it("reports non-zero exit code via sanitized error", async () => {
    const { env, runner } = buildMockEnvironment();
    const errLine = JSON.stringify({ type: "result", result: "API key invalid" });
    runner.enqueue({ exitCode: 1, stdout: errLine, stderr: "" });

    const agent = makeAgent(ClaudeAgent, env);
    const res = await agent.runTask({ prompt: "ping", role: "coder" });

    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(1);
    expect(res.error).toContain("API key invalid");
  });
});

describe("CodexAgent — runTask with MockCommandRunner", () => {
  it("extracts token usage from Codex trailing footer", async () => {
    const { env, runner } = buildMockEnvironment();
    runner.enqueue({
      exitCode: 0,
      stdout: "done with work\ntokens used\n1,234",
      stderr: ""
    });

    const agent = makeAgent(CodexAgent, env);
    const res = await agent.runTask({ prompt: "refactor", role: "coder" });

    expect(res.ok).toBe(true);
    expect(res.tokens_out).toBe(1234);
    expect(runner.lastCall.options.input).toBe("refactor");
  });
});

describe("GeminiAgent — reviewTask with MockCommandRunner", () => {
  it("forwards stdout as output and includes --output-format json for reviews", async () => {
    const { env, runner } = buildMockEnvironment();
    runner.enqueue({ exitCode: 0, stdout: "{\"ok\":true}", stderr: "" });

    const agent = makeAgent(GeminiAgent, env);
    const res = await agent.reviewTask({ prompt: "review", role: "reviewer" });

    expect(res.ok).toBe(true);
    expect(res.output).toBe("{\"ok\":true}");
    expect(runner.lastCall.args).toEqual(expect.arrayContaining(["--output-format", "json"]));
  });
});

describe("AiderAgent — runTask with MockCommandRunner", () => {
  it("passes --yes and --message prompt flags", async () => {
    const { env, runner } = buildMockEnvironment();
    runner.enqueue({ exitCode: 0, stdout: "done", stderr: "" });

    const agent = makeAgent(AiderAgent, env);
    const res = await agent.runTask({ prompt: "fix bug", role: "coder" });

    expect(res.ok).toBe(true);
    expect(runner.lastCall.args).toEqual(expect.arrayContaining(["--yes", "--message", "fix bug"]));
  });
});

describe("OpenCodeAgent — reviewTask with MockCommandRunner", () => {
  it("adds --format json for reviews and forwards stdout", async () => {
    const { env, runner } = buildMockEnvironment();
    runner.enqueue({ exitCode: 0, stdout: "{\"review\":\"ok\"}", stderr: "" });

    const agent = makeAgent(OpenCodeAgent, env);
    const res = await agent.reviewTask({ prompt: "audit", role: "reviewer" });

    expect(res.ok).toBe(true);
    expect(res.output).toBe("{\"review\":\"ok\"}");
    expect(runner.lastCall.args).toEqual(expect.arrayContaining(["--format", "json"]));
  });
});
