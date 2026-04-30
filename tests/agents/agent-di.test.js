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

// merged-from: 2 environment-threading tests (custom + default) collapsed.
describe("createAgent() — threads environment to concrete agents", () => {
  it.each([
    ["custom env",  () => buildMockEnvironment().env, (env) => env],
    ["default env", () => undefined,                  () => defaultEnvironment]
  ])("%s reaches the agent.environment field", (_label, mkEnv, expectFn) => {
    const env = mkEnv();
    const agent = createAgent("claude", { roles: {} }, silentLogger, env);
    expect(agent.environment).toBe(expectFn(env));
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

// merged-from: 4 per-agent DI smoke tests (Codex/Gemini/Aider/OpenCode)
// collapsed into one table. Each row stands in for the same DI contract:
// MockCommandRunner replaces execa, the agent's run/review method emits the
// expected CLI fingerprint, and stdout/stderr round-trip back through the
// result. Per-agent payloads vary; the assertions are uniform.
// kept-because: ClaudeAgent stays out of this table — it has its own
// describe above with two separate cases (success NDJSON parse + sanitized
// error path) that don't fit the simple fingerprint check.
describe("agent adapters — DI smoke tests with MockCommandRunner", () => {
  it.each([
    [
      "CodexAgent",   CodexAgent,   "runTask",    "coder",
      { stdout: "done with work\ntokens used\n1,234", stderr: "" },
      { prompt: "refactor" },
      (res, runner) => {
        expect(res.tokens_out).toBe(1234);
        expect(runner.lastCall.options.input).toBe("refactor");
      }
    ],
    [
      "GeminiAgent",  GeminiAgent,  "reviewTask", "reviewer",
      { stdout: '{"ok":true}', stderr: "" },
      { prompt: "review" },
      (res, runner) => {
        expect(res.output).toBe('{"ok":true}');
        expect(runner.lastCall.args).toEqual(expect.arrayContaining(["--output-format", "json"]));
      }
    ],
    [
      "AiderAgent",   AiderAgent,   "runTask",    "coder",
      { stdout: "done", stderr: "" },
      { prompt: "fix bug" },
      (_res, runner) => {
        expect(runner.lastCall.args).toEqual(expect.arrayContaining(["--yes", "--message", "fix bug"]));
      }
    ],
    [
      "OpenCodeAgent", OpenCodeAgent, "reviewTask", "reviewer",
      { stdout: '{"review":"ok"}', stderr: "" },
      { prompt: "audit" },
      (res, runner) => {
        expect(res.output).toBe('{"review":"ok"}');
        expect(runner.lastCall.args).toEqual(expect.arrayContaining(["--format", "json"]));
      }
    ]
  ])("%s.%s round-trips through MockCommandRunner", async (_name, AgentClass, method, role, mockResult, taskArgs, assertExtra) => {
    const { env, runner } = buildMockEnvironment();
    runner.enqueue({ exitCode: 0, ...mockResult });

    const agent = makeAgent(AgentClass, env);
    const res = await agent[method]({ ...taskArgs, role });

    expect(res.ok).toBe(true);
    assertExtra(res, runner);
  });
});
