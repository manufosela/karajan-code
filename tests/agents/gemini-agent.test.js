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

describe("GeminiAgent", () => {
  let runCommand;
  let GeminiAgent;

  beforeEach(async () => {
    vi.resetAllMocks();
    const proc = await import("../../src/utils/process.js");
    runCommand = proc.runCommand;
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "output", stderr: "" });
    const mod = await import("../../src/agents/gemini-agent.js");
    GeminiAgent = mod.GeminiAgent;
  });

  // KJC-BUG-0121: the prompt travels via stdin (`input`), NEVER as a CLI
  // argument — solomon prompts embed whole diffs and E2BIG kills the spawn.
  // Only reviewTask appends `--output-format json`.
  describe("stdin prompt and output format", () => {
    it.each([
      ["runTask",    "coder",    "build feature", false],
      ["reviewTask", "reviewer", "review code",   true]
    ])("%s sends the prompt via stdin; --output-format json=%s", async (method, role, prompt, expectsJson) => {
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent[method]({ prompt, role });

      const args = runCommand.mock.calls[0][1];
      expect(args).not.toContain("-p");
      expect(args).not.toContain(prompt);
      expect(runCommand.mock.calls[0][2].input).toBe(prompt);
      if (expectsJson) {
        const fmtIdx = args.indexOf("--output-format");
        expect(fmtIdx).toBeGreaterThanOrEqual(0);
        expect(args[fmtIdx + 1]).toBe("json");
      } else {
        expect(args).not.toContain("--output-format");
      }
    });
  });

  // merged-from: 2 exit-code tests collapsed (success vs non-zero).
  describe("exit code handling", () => {
    it.each([
      [0, "done", "",      { ok: true,  output: "done", error: "",      exitCode: 0 }],
      [2, "",     "crash", { ok: false, output: "",     error: "crash", exitCode: 2 }]
    ])("exit=%i → ok=%s", async (exitCode, stdout, stderr, expected) => {
      runCommand.mockResolvedValue({ exitCode, stdout, stderr });
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });
      expect(result.ok).toBe(expected.ok);
      expect(result.output).toBe(expected.output);
      expect(result.error).toBe(expected.error);
      expect(result.exitCode).toBe(expected.exitCode);
    });
  });

  // merged-from: 3 model-config tests (coder set / reviewer set / none).
  describe("model configuration", () => {
    const cfg = (role, model) => ({ ...baseConfig, roles: { coder: {}, reviewer: {}, [role]: { model } } });
    it.each([
      ["coder",    "runTask",    "gemini-2.5-pro"],
      ["reviewer", "reviewTask", "gemini-2.5-flash"]
    ])("%s adds --model %s", async (role, method, model) => {
      const agent = new GeminiAgent("gemini", cfg(role, model), logger);
      await agent[method]({ prompt: "t", role });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain(model);
    });

    it("omits --model when no model configured", async () => {
      await new GeminiAgent("gemini", baseConfig, logger).runTask({ prompt: "test", role: "coder" });
      expect(runCommand.mock.calls[0][1]).not.toContain("--model");
    });
  });

  // KJC-BUG-0121 layer 2: headless gemini refuses untrusted workspaces —
  // every spawn declares GEMINI_CLI_TRUST_WORKSPACE. stdin stays unset
  // (the runner wires `input` itself; no Claude-style stdin=ignore).
  // Since KJC-TSK-0693 the trust var is a partial overlay: BaseAgent merges
  // it over the inherited env and filters — PATH survives, secrets don't.
  describe("workspace trust env", () => {
    it("sets GEMINI_CLI_TRUST_WORKSPACE=true on the allowlisted env, no stdin override", async () => {
      process.env.KJC_0693_CANARY = "must-not-leak";
      try {
        const agent = new GeminiAgent("gemini", baseConfig, logger);
        await agent.runTask({ prompt: "test", role: "coder" });
        const env = runCommand.mock.calls[0][2].env;
        expect(env.GEMINI_CLI_TRUST_WORKSPACE).toBe("true");
        expect(env.PATH).toBeDefined();
        expect(env.KJC_0693_CANARY).toBeUndefined();
        expect(runCommand.mock.calls[0][2].stdin).toBeUndefined();
      } finally {
        delete process.env.KJC_0693_CANARY;
      }
    });
  });

  it("returns stdout as output and stderr as error (no pickOutput)", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "response", stderr: "warn" });
    const result = await new GeminiAgent("gemini", baseConfig, logger).runTask({ prompt: "test", role: "coder" });
    expect(result.output).toBe("response");
    expect(result.error).toBe("warn");
  });

  it("forwards onOutput, silenceTimeoutMs and timeout to runCommand", async () => {
    const onOutput = vi.fn();
    await new GeminiAgent("gemini", baseConfig, logger).runTask({
      prompt: "test", role: "coder", onOutput, silenceTimeoutMs: 15000, timeoutMs: 90000
    });

    const opts = runCommand.mock.calls[0][2];
    expect(opts.onOutput).toBe(onOutput);
    expect(opts.silenceTimeoutMs).toBe(15000);
    expect(opts.timeout).toBe(90000);
  });

  // Φ0-C — Phase 0 cache metrics for Gemini context-caching API.
  // Gemini surfaces `usageMetadata.cachedContentTokenCount` whenever
  // the response uses a cached context (https://ai.google.dev/api/caching).
  // The CLI exposes this via --output-format json (today: reviewTask
  // only). Plain runTask currently leaves cached_tokens undefined =
  // unmeasured.
  describe("cached_tokens extraction from gemini usageMetadata", () => {
    it.each([
      ["with cachedContentTokenCount",
        `{"response":"ok","usageMetadata":{"promptTokenCount":1500,"candidatesTokenCount":400,"cachedContentTokenCount":1200,"totalTokenCount":1900}}`,
        { tokens_in: 1500, tokens_out: 400, cached_tokens: 1200 }],
      ["usageMetadata without cachedContentTokenCount",
        `{"response":"ok","usageMetadata":{"promptTokenCount":800,"candidatesTokenCount":200,"totalTokenCount":1000}}`,
        { tokens_in: 800, tokens_out: 200, cached_tokens: 0 }],
      ["snake_case usage_metadata variant",
        `{"usage_metadata":{"promptTokenCount":300,"candidatesTokenCount":150,"cachedContentTokenCount":250}}`,
        { tokens_in: 300, tokens_out: 150, cached_tokens: 250 }],
      ["nested under response wrapper",
        `{"response":{"usageMetadata":{"promptTokenCount":600,"candidatesTokenCount":120,"cachedContentTokenCount":500}}}`,
        { tokens_in: 600, tokens_out: 120, cached_tokens: 500 }]
    ])("%s", async (_n, stdout, expected) => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout, stderr: "" });
      const result = await new GeminiAgent("gemini", baseConfig, logger).reviewTask({ prompt: "r", role: "reviewer" });
      expect(result.tokens_in).toBe(expected.tokens_in);
      expect(result.tokens_out).toBe(expected.tokens_out);
      expect(result.cached_tokens).toBe(expected.cached_tokens);
    });

    it("leaves cached_tokens undefined when stdout has no usageMetadata (unmeasured)", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "plain response text\n", stderr: "" });
      const result = await new GeminiAgent("gemini", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(result.tokens_in).toBeUndefined();
      expect(result.tokens_out).toBeUndefined();
      expect(result.cached_tokens).toBeUndefined();
    });

    it("ignores malformed JSON in stdout and stays unmeasured", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: '{"usageMetadata": not-valid json}', stderr: "" });
      const result = await new GeminiAgent("gemini", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(result.cached_tokens).toBeUndefined();
    });
  });
});
