import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createNoopLogger } from "../_fixtures/loggers.js";
import { baseAgentConfig } from "../_fixtures/agents.js";

vi.mock("../../src/utils/process.js", () => ({ runCommand: vi.fn() }));
vi.mock("../../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/local/bin/${name}`)
}));

const baseConfig = baseAgentConfig();
const logger = createNoopLogger();

describe("ClaudeAgent", () => {
  let runCommand;
  let ClaudeAgent;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ runCommand } = await import("../../src/utils/process.js"));
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    ({ ClaudeAgent } = await import("../../src/agents/claude-agent.js"));
  });

  afterEach(() => { delete process.env.CLAUDECODE; });

  // merged-from: 4 CLAUDECODE/stdin tests (run/review × set/unset).
  describe("cleanExecaOpts() — CLAUDECODE + stdin", () => {
    it.each([
      ["runTask",    (a) => a.runTask({ prompt: "t", role: "coder" })],
      ["reviewTask", (a) => a.reviewTask({ prompt: "r", role: "reviewer" })]
    ])("%s strips CLAUDECODE, preserves PATH, sets stdin=ignore", async (_n, call) => {
      process.env.CLAUDECODE = "1";
      await call(new ClaudeAgent("claude", baseConfig, logger));

      const opts = runCommand.mock.calls[0][2];
      expect(opts.env).toBeDefined();
      expect(opts.env).not.toHaveProperty("CLAUDECODE");
      expect(opts.env).toHaveProperty("PATH");
      expect(opts.stdin).toBe("ignore");
    });

    it("propaga el rol del task como KJ_POLICY_ROLE al subproceso (PL-C, KJC-TSK-0735)", async () => {
      await new ClaudeAgent("claude", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(runCommand.mock.calls[0][2].env.KJ_POLICY_ROLE).toBe("coder");
      // El rol del ORQUESTADOR es autoritativo: task.env no lo spoofea
      // (catch de codex — un env manipulado seria un bypass de reglas por rol).
      await new ClaudeAgent("claude", baseConfig, logger).runTask({ prompt: "t", role: "coder", env: { ...process.env, KJ_POLICY_ROLE: "tester" } });
      expect(runCommand.mock.calls[1][2].env.KJ_POLICY_ROLE).toBe("coder");
    });

    it("does not crash when CLAUDECODE is unset", async () => {
      delete process.env.CLAUDECODE;
      await new ClaudeAgent("claude", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(runCommand.mock.calls[0][2].env).not.toHaveProperty("CLAUDECODE");
    });
  });

  // merged-from: 5 pickOutput tests collapsed to 3 distinct branches
  // (stderr fallback / stdout priority / both empty) + reviewTask raw path.
  describe("pickOutput() — stderr/stdout priority", () => {
    it.each([
      ["stderr fallback", "", '{"type":"result","result":"task done"}', "task done"],
      ["stdout priority", '{"type":"result","result":"from stdout"}', "other", "from stdout"],
      ["both empty",      "", "", ""]
    ])("runTask: %s", async (_n, stdout, stderr, expected) => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout, stderr });
      const result = await new ClaudeAgent("claude", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(result.ok).toBe(true);
      expect(result.output).toBe(expected);
    });

    it("reviewTask prefers stdout over stderr (raw, no NDJSON parsing)", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "stdout-data", stderr: "stderr-data" });
      const result = await new ClaudeAgent("claude", baseConfig, logger).reviewTask({ prompt: "r", role: "reviewer" });
      expect(result.output).toBe("stdout-data");
    });
  });

  describe("--allowedTools flag", () => {
    it("includes all 6 tools for runTask", async () => {
      await new ClaudeAgent("claude", baseConfig, logger).runTask({ prompt: "t", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--allowedTools");
      const tools = args.slice(args.indexOf("--allowedTools") + 1).filter((a) => !a.startsWith("-"));
      for (const t of ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]) expect(tools).toContain(t);
    });

    it("includes --allowedTools for reviewTask too", async () => {
      await new ClaudeAgent("claude", baseConfig, logger).reviewTask({ prompt: "r", role: "reviewer" });
      expect(runCommand.mock.calls[0][1]).toContain("--allowedTools");
    });
  });

  // Φ1-D (KJC-PCS-0057): stable/volatile system-prompt split.
  describe("buildPromptArgs — system-prompt split", () => {
    it.each([
      ["runTask",    (a, t) => a.runTask({ ...t, role: "coder" })],
      ["reviewTask", (a, t) => a.reviewTask({ ...t, role: "reviewer" })]
    ])("%s with stablePrompt+volatilePrompt sends -p volatile and --append-system-prompt stable", async (_n, call) => {
      await call(new ClaudeAgent("claude", baseConfig, logger), {
        prompt: "joined full prompt",
        stablePrompt: "STABLE RULES",
        volatilePrompt: "VOLATILE TASK"
      });

      const args = runCommand.mock.calls[0][1];
      expect(args[args.indexOf("-p") + 1]).toBe("VOLATILE TASK");
      expect(args[args.indexOf("--append-system-prompt") + 1]).toBe("STABLE RULES");
      expect(args).not.toContain("joined full prompt");
    });

    it.each([
      ["only stablePrompt",   { prompt: "full", stablePrompt: "S" }],
      ["only volatilePrompt", { prompt: "full", volatilePrompt: "V" }],
      ["neither",             { prompt: "full" }]
    ])("falls back to -p prompt when %s is provided", async (_n, task) => {
      await new ClaudeAgent("claude", baseConfig, logger).runTask({ ...task, role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args[args.indexOf("-p") + 1]).toBe("full");
      expect(args).not.toContain("--append-system-prompt");
    });
  });

  // merged-from: 4 buildArgs tests (-p prompt, json default, stream-json+verbose).
  describe("buildArgs — -p flag and output format", () => {
    it("includes -p with the task prompt", async () => {
      await new ClaudeAgent("claude", baseConfig, logger).runTask({ prompt: "implement X", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      const pIdx = args.indexOf("-p");
      expect(pIdx).toBeGreaterThanOrEqual(0);
      expect(args[pIdx + 1]).toBe("implement X");
    });

    it.each([
      [undefined,    "json",        false],
      [() => vi.fn(), "stream-json", true]
    ])("output-format=%s, verbose=%s", async (mkOnOutput, expectedFmt, expectVerbose) => {
      await new ClaudeAgent("claude", baseConfig, logger).runTask({
        prompt: "t", role: "coder", onOutput: mkOnOutput?.()
      });

      const args = runCommand.mock.calls[0][1];
      const fmtIdx = args.indexOf("--output-format");
      expect(args[fmtIdx + 1]).toBe(expectedFmt);
      if (expectVerbose) expect(args).toContain("--verbose");
    });
  });

  // merged-from: 2 exit-code + 2 rate-limit tests; same observable contract.
  describe("exit code & rate-limit error handling", () => {
    it.each([
      [1,   "fatal error",                                       /fatal error/],
      [143, "killed",                                            /killed/],
      [1,   "Rate limit exceeded. Please wait before retrying.", /Rate limit/],
      [1,   '{"error":"Rate limit exceeded","retryAfter":30}',    /rate.?limit/i]
    ])("exit=%i, stderr=%s → ok:false, error matches %s", async (exitCode, stderr, errMatch) => {
      runCommand.mockResolvedValue({ exitCode, stdout: "", stderr });
      const result = await new ClaudeAgent("claude", baseConfig, logger).runTask({ prompt: "t", role: "coder" });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(exitCode);
      expect(errMatch.test(result.error)).toBe(true);
    });
  });

  describe("stream-json output parsing", () => {
    const runStream = async (stderr) => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr });
      return await new ClaudeAgent("claude", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
    };

    it("extracts result text from NDJSON stream output", async () => {
      const ndjson = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"working..."}]}}',
        '{"type":"result","result":"final answer"}'
      ].join("\n");
      expect((await runStream(ndjson)).output).toBe("final answer");
    });

    it("falls back to accumulating assistant text when no result message", async () => {
      const ndjson = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"hello "}]}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"world"}]}}'
      ].join("\n");
      expect((await runStream(ndjson)).output).toBe("hello world");
    });

    it("returns raw text when NDJSON parsing fails", async () => {
      expect((await runStream("plain text output")).output).toBe("plain text output");
    });

    // kept-because: regression for `--output-format json` array payload — Claude 2.x
    // emits one JSON array per response; the previous `split('\n')` strategy made
    // `kj plan` save the whole array as the plan's `approach` field and skip HU
    // generation entirely. Do NOT delete.
    // regression-for: PR-id-pinned
    it("extracts result text from a JSON array payload (regression)", async () => {
      const arrayPayload = JSON.stringify([
        { type: "system", subtype: "init", session_id: "abc" },
        { type: "assistant", message: { content: [{ type: "text", text: "thinking…" }] } },
        { type: "result", result: "final plan text" }
      ]);
      expect((await runStream(arrayPayload)).output).toBe("final plan text");
    });

    it("accumulates assistant text from a JSON array when no result event", async () => {
      const arrayPayload = JSON.stringify([
        { type: "assistant", message: { content: [{ type: "text", text: "step1 " }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "step2" }] } }
      ]);
      expect((await runStream(arrayPayload)).output).toBe("step1 step2");
    });
  });

  it("wraps onOutput in a stream-json filter and forwards timing options", async () => {
    const onOutput = vi.fn();
    await new ClaudeAgent("claude", baseConfig, logger).runTask({
      prompt: "t", role: "coder", onOutput, silenceTimeoutMs: 30000, timeoutMs: 120000
    });

    const opts = runCommand.mock.calls[0][2];
    expect(opts.onOutput).toBeDefined();
    expect(opts.onOutput).not.toBe(onOutput);
    expect(opts.silenceTimeoutMs).toBe(30000);
    expect(opts.timeout).toBe(120000);
  });

  // merged-from: 3 model-config tests (coder set / reviewer set / none).
  describe("model configuration", () => {
    const cfg = (role, model) => ({ ...baseConfig, roles: { coder: {}, reviewer: {}, [role]: { model } } });
    it.each([
      ["coder",    "runTask",    "claude-opus-4-20250514"],
      ["reviewer", "reviewTask", "claude-sonnet-4-20250514"]
    ])("%s model adds --model %s", async (role, method, model) => {
      const agent = new ClaudeAgent("claude", cfg(role, model), logger);
      await agent[method]({ prompt: "t", role });
      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain(model);
    });

    it("omits --model when no model is configured", async () => {
      await new ClaudeAgent("claude", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(runCommand.mock.calls[0][1]).not.toContain("--model");
    });
  });

  describe("usage metrics extraction", () => {
    const usage = (input_tokens, output_tokens) => ({ input_tokens, output_tokens });
    it.each([
      ["runTask", "coder", { type: "result", result: "done", total_cost_usd: 0.117, usage: usage(3000, 4000),
        modelUsage: { "claude-opus-4-6[1m]": { inputTokens: 3000, outputTokens: 4000, costUSD: 0.117 } } },
        { tokens_in: 3000, tokens_out: 4000, cost_usd: 0.117, model: "claude-opus-4-6[1m]", cached_tokens: 0 }],
      ["reviewTask", "reviewer", { type: "result", result: "review", total_cost_usd: 0.03, usage: usage(500, 800),
        modelUsage: { haiku: { inputTokens: 500, outputTokens: 800, costUSD: 0.03 } } },
        { tokens_in: 500, tokens_out: 800, cost_usd: 0.03, model: "haiku", cached_tokens: 0 }],
      ["runTask", "coder", { type: "result", result: "done", total_cost_usd: 0.01, usage: usage(100, 200) },
        { tokens_in: 100, tokens_out: 200, cost_usd: 0.01, model: null, cached_tokens: 0 }]
    ])("%s extracts tokens/cost/model", async (method, role, ndjson, exp) => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: JSON.stringify(ndjson) });
      const result = await new ClaudeAgent("claude", baseConfig, logger)[method]({ prompt: "t", role });
      expect(result.tokens_in).toBe(exp.tokens_in);
      expect(result.tokens_out).toBe(exp.tokens_out);
      expect(result.cost_usd).toBe(exp.cost_usd);
      expect(result.model).toBe(exp.model);
      expect(result.cached_tokens).toBe(exp.cached_tokens);
    });

    // Φ0-A — Phase 0 cache metrics: Anthropic exposes both cache_read_input_tokens
    // (served from automatic prompt cache) and cache_creation_input_tokens (just
    // written to cache). cached_tokens aggregates both — the total volume of
    // input that touched the caching machinery this call.
    it.each([
      ["cache read only", { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 1500 }, 1500],
      ["cache creation only", { input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: 800 }, 800],
      ["read + creation mixed", {
        input_tokens: 200, output_tokens: 100,
        cache_read_input_tokens: 1500, cache_creation_input_tokens: 800
      }, 2300]
    ])("extracts cached_tokens: %s", async (_name, usageObj, expectedCached) => {
      const ndjson = { type: "result", result: "ok", total_cost_usd: 0.05, usage: usageObj };
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: JSON.stringify(ndjson) });
      const result = await new ClaudeAgent("claude", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(result.cached_tokens).toBe(expectedCached);
      expect(result.tokens_in).toBe(200);
      expect(result.tokens_out).toBe(100);
    });
  });

  describe("sanitizeClaudeError", () => {
    let sanitizeClaudeError;
    beforeEach(async () => { ({ sanitizeClaudeError } = await import("../../src/agents/claude-agent.js")); });

    it.each([
      [["{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"abc\"}",
        "{\"type\":\"system\",\"subtype\":\"api_retry\",\"attempt\":1,\"error_status\":502}",
        "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":true,\"result\":\"API Error: 502 connect ECONNREFUSED 127.0.0.1:443\"}"
      ].join("\n"), "API Error: 502 connect ECONNREFUSED 127.0.0.1:443"],
      [["{\"type\":\"system\",\"subtype\":\"init\"}",
        "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Something went wrong\"}]}}"
      ].join("\n"), "Something went wrong"],
      ["Error: command not found\n", "Error: command not found"]
    ])("extracts %#", (raw, expected) => {
      expect(sanitizeClaudeError(raw)).toBe(expected);
    });

    it("truncates raw output for unrecognized formats (≤ 200 chars)", () => {
      expect(sanitizeClaudeError('{"type":"unknown","data":"x"}'.repeat(20)).length).toBeLessThanOrEqual(200);
    });

    it.each([null, ""])("returns 'Unknown error' for empty input (%p)", (input) => {
      expect(sanitizeClaudeError(input)).toBe("Unknown error");
    });
  });
});
