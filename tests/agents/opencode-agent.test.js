import { describe, expect, it, vi, beforeEach } from "vitest";
import { createNoopLogger } from "../_fixtures/loggers.js";
import { baseAgentConfig } from "../_fixtures/agents.js";

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/local/bin/${name}`)
}));

const baseConfig = baseAgentConfig();
const logger = createNoopLogger();

describe("OpenCodeAgent", () => {
  let runCommand;
  let OpenCodeAgent;

  beforeEach(async () => {
    vi.resetAllMocks();
    const proc = await import("../../src/utils/process.js");
    runCommand = proc.runCommand;
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "" });
    const mod = await import("../../src/agents/opencode-agent.js");
    OpenCodeAgent = mod.OpenCodeAgent;
  });

  describe("basic construction", () => {
    it("stores name, config, and logger", () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      expect(agent.name).toBe("opencode");
      expect(agent.config).toBe(baseConfig);
      expect(agent.logger).toBe(logger);
    });
  });

  // merged-from: 7 runTask/reviewTask arg tests collapsed into a shared
  // it.each. Both methods always lead with `run`, end with the prompt and
  // never feed the prompt over stdin; only reviewTask adds --format json.
  describe("subcommand + prompt placement (runTask & reviewTask)", () => {
    it.each([
      ["runTask",    "coder",    "fix bug",     false],
      ["reviewTask", "reviewer", "review code", true]
    ])("%s: starts with 'run', prompt last, no stdin, --format json=%s", async (method, role, prompt, expectsFormatJson) => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent[method]({ prompt, role });

      const [, args, opts] = runCommand.mock.calls[0];
      expect(args[0]).toBe("run");
      expect(args[args.length - 1]).toBe(prompt);
      expect(opts.input).toBeUndefined();
      if (expectsFormatJson) {
        expect(args).toContain("--format");
        expect(args).toContain("json");
      } else {
        expect(args).not.toContain("--format");
      }
    });
  });

  // merged-from: 4 --model tests (coder / reviewer / order vs prompt / omitted)
  // collapsed into one it.each. Each row drives runTask or reviewTask with a
  // role-specific model and asserts presence + relative position.
  describe("model configuration", () => {
    const cfg = (role, model) => ({ ...baseConfig, roles: { coder: {}, reviewer: {}, [role]: { model } } });
    it.each([
      ["coder",    "runTask",    "anthropic/claude-3-5-sonnet"],
      ["reviewer", "reviewTask", "openai/gpt-4o"],
      ["coder",    "runTask",    "test-model"]
    ])("%s adds --model %s before the prompt", async (role, method, model) => {
      const agent = new OpenCodeAgent("opencode", cfg(role, model), logger);
      const prompt = `prompt-${role}`;
      await agent[method]({ prompt, role });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain(model);
      expect(args.indexOf("--model")).toBeLessThan(args.indexOf(prompt));
    });

    it("omits --model when not configured", async () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });
      expect(runCommand.mock.calls[0][1]).not.toContain("--model");
    });
  });

  // merged-from: 2 exit-code tests (ok=true on 0 / ok=false on 1) collapsed.
  describe("exit code handling", () => {
    it.each([
      [0, "success", "",      { ok: true,  output: "success", error: "",      exitCode: 0 }],
      [1, "",        "error", { ok: false, output: "",        error: "error", exitCode: 1 }]
    ])("exit=%i → result reflects ok+output+error", async (exitCode, stdout, stderr, expected) => {
      runCommand.mockResolvedValue({ exitCode, stdout, stderr });
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      const result = await agent.runTask({ prompt: "t", role: "coder" });
      expect(result).toEqual(expected);
    });
  });

  // merged-from: 2 stdin/env tests collapsed. OpenCode does not touch stdin
  // (unlike Claude). Since KJC-TSK-0693 the env is never inherited whole:
  // BaseAgent injects the allowlisted env for every agent.
  describe("no special stdin handling, allowlisted env", () => {
    it("does NOT set stdin", async () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });
      expect(runCommand.mock.calls[0][2].stdin).toBeUndefined();
    });

    it("receives the allowlisted env, not the raw inherited one", async () => {
      process.env.KJC_0693_CANARY = "must-not-leak";
      try {
        const agent = new OpenCodeAgent("opencode", baseConfig, logger);
        await agent.runTask({ prompt: "test", role: "coder" });
        const env = runCommand.mock.calls[0][2].env;
        expect(env).toBeDefined();
        expect(env.KJC_0693_CANARY).toBeUndefined();
        expect(env.PATH).toBeDefined();
      } finally {
        delete process.env.KJC_0693_CANARY;
      }
    });
  });

  describe("timeout and streaming passthrough", () => {
    it("passes onOutput, silenceTimeoutMs, and timeout to runCommand", async () => {
      const onOutput = vi.fn();
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({
        prompt: "test",
        role: "coder",
        onOutput,
        silenceTimeoutMs: 10000,
        timeoutMs: 50000
      });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.onOutput).toBe(onOutput);
      expect(opts.silenceTimeoutMs).toBe(10000);
      expect(opts.timeout).toBe(50000);
    });
  });

  // Φ0-D — OpenCode often runs against LiteLLM-backed providers; when
  // `--format json` (reviewTask) is on, the CLI emits a JSON document
  // whose `usage` block carries `prompt_tokens_details.cached_tokens`.
  describe("cached_tokens extraction (LiteLLM passthrough via --format json)", () => {
    it.each([
      ["root usage with cached_tokens",
        `{"result":"ok","usage":{"prompt_tokens":2200,"completion_tokens":380,"prompt_tokens_details":{"cached_tokens":1700}}}`,
        { tokens_in: 2200, tokens_out: 380, cached_tokens: 1700 }],
      ["nested under result wrapper",
        `{"result":{"text":"done","usage":{"prompt_tokens":900,"completion_tokens":150,"prompt_tokens_details":{"cached_tokens":600}}}}`,
        { tokens_in: 900, tokens_out: 150, cached_tokens: 600 }],
      ["array payload — usage on one element",
        `[{"type":"chunk"},{"type":"final","usage":{"prompt_tokens":400,"completion_tokens":80}}]`,
        { tokens_in: 400, tokens_out: 80, cached_tokens: 0 }],
      ["line-delimited JSON in mixed output",
        `pre\n{"usage":{"prompt_tokens":300,"completion_tokens":60,"prompt_tokens_details":{"cached_tokens":250}}}\npost`,
        { tokens_in: 300, tokens_out: 60, cached_tokens: 250 }]
    ])("%s", async (_n, stdout, expected) => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout, stderr: "" });
      const result = await new OpenCodeAgent("opencode", baseConfig, logger).reviewTask({ prompt: "r", role: "reviewer" });
      expect(result.tokens_in).toBe(expected.tokens_in);
      expect(result.tokens_out).toBe(expected.tokens_out);
      expect(result.cached_tokens).toBe(expected.cached_tokens);
    });

    it("leaves usage fields undefined when stdout is plain text (unmeasured)", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "plain output\n", stderr: "" });
      const result = await new OpenCodeAgent("opencode", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(result.tokens_in).toBeUndefined();
      expect(result.cached_tokens).toBeUndefined();
    });

    it("ignores malformed JSON and stays unmeasured", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: '{"usage": not-valid}', stderr: "" });
      const result = await new OpenCodeAgent("opencode", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(result.cached_tokens).toBeUndefined();
    });
  });
});
