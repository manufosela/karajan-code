import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/local/bin/${name}`)
}));

const baseConfig = {
  roles: { coder: {}, reviewer: {} },
  coder_options: {},
  reviewer_options: {}
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe("ClaudeAgent", () => {
  let runCommand;
  let ClaudeAgent;

  beforeEach(async () => {
    vi.resetAllMocks();
    const proc = await import("../../src/utils/process.js");
    runCommand = proc.runCommand;
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const mod = await import("../../src/agents/claude-agent.js");
    ClaudeAgent = mod.ClaudeAgent;
  });

  afterEach(() => {
    delete process.env.CLAUDECODE;
  });

  describe("cleanExecaOpts() — CLAUDECODE env stripping", () => {
    it("strips CLAUDECODE env var from subprocess options", async () => {
      process.env.CLAUDECODE = "1";
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.env).toBeDefined();
      expect(opts.env).not.toHaveProperty("CLAUDECODE");
    });

    it("preserves other env vars when stripping CLAUDECODE", async () => {
      process.env.CLAUDECODE = "1";
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.env).toHaveProperty("PATH");
    });

    it("works when CLAUDECODE is not set (no crash)", async () => {
      delete process.env.CLAUDECODE;
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.env).toBeDefined();
      expect(opts.env).not.toHaveProperty("CLAUDECODE");
    });

    it("strips CLAUDECODE from reviewTask too", async () => {
      process.env.CLAUDECODE = "1";
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.env).not.toHaveProperty("CLAUDECODE");
    });
  });

  describe("cleanExecaOpts() — stdin handling", () => {
    it("sets stdin to 'ignore' for runTask", async () => {
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      expect(runCommand.mock.calls[0][2].stdin).toBe("ignore");
    });

    it("sets stdin to 'ignore' for reviewTask", async () => {
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      expect(runCommand.mock.calls[0][2].stdin).toBe("ignore");
    });
  });

  describe("pickOutput() — stderr/stdout priority", () => {
    it("returns stderr content when stdout is empty (Claude 2.x behavior)", async () => {
      const stderrData = '{"type":"result","result":"task done"}';
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: stderrData });

      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.ok).toBe(true);
      expect(result.output).toBe("task done");
    });

    it("returns stdout content when stdout is available", async () => {
      const stdoutData = '{"type":"result","result":"from stdout"}';
      runCommand.mockResolvedValue({ exitCode: 0, stdout: stdoutData, stderr: "other" });

      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.ok).toBe(true);
      expect(result.output).toBe("from stdout");
    });

    it("returns empty string when both stdout and stderr are empty", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.ok).toBe(true);
      expect(result.output).toBe("");
    });

    it("pickOutput prefers stdout over stderr for reviewTask raw output", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "stdout-data", stderr: "stderr-data" });

      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.reviewTask({ prompt: "review", role: "reviewer" });

      expect(result.output).toBe("stdout-data");
    });

    it("reviewTask falls back to stderr when stdout is empty", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "stderr-only" });

      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.reviewTask({ prompt: "review", role: "reviewer" });

      expect(result.output).toBe("stderr-only");
    });
  });

  describe("--allowedTools flag", () => {
    it("includes --allowedTools with all 6 tools for runTask", async () => {
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--allowedTools");
      const toolsIdx = args.indexOf("--allowedTools");
      const tools = args.slice(toolsIdx + 1).filter(a => !a.startsWith("-"));
      expect(tools).toContain("Read");
      expect(tools).toContain("Write");
      expect(tools).toContain("Edit");
      expect(tools).toContain("Bash");
      expect(tools).toContain("Glob");
      expect(tools).toContain("Grep");
    });

    it("includes --allowedTools for reviewTask", async () => {
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--allowedTools");
    });
  });

  describe("buildArgs — -p flag and output format", () => {
    it("includes -p flag with the task prompt", async () => {
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "implement feature X", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      const pIdx = args.indexOf("-p");
      expect(pIdx).toBeGreaterThanOrEqual(0);
      expect(args[pIdx + 1]).toBe("implement feature X");
    });

    it("uses --output-format json when no onOutput callback", async () => {
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      const fmtIdx = args.indexOf("--output-format");
      expect(fmtIdx).toBeGreaterThanOrEqual(0);
      expect(args[fmtIdx + 1]).toBe("json");
    });

    it("uses --output-format stream-json when onOutput callback is provided", async () => {
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder", onOutput: vi.fn() });

      const args = runCommand.mock.calls[0][1];
      const fmtIdx = args.indexOf("--output-format");
      expect(fmtIdx).toBeGreaterThanOrEqual(0);
      expect(args[fmtIdx + 1]).toBe("stream-json");
    });

    it("includes --verbose when streaming", async () => {
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder", onOutput: vi.fn() });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--verbose");
    });
  });

  describe("non-zero exit code handling", () => {
    it("returns ok: false on non-zero exit code", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "fatal error" });

      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "fail", role: "coder" });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("fatal error");
    });

    it("returns ok: false for exit code 143 (killed)", async () => {
      runCommand.mockResolvedValue({ exitCode: 143, stdout: "", stderr: "killed" });

      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "timeout", role: "coder" });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(143);
    });
  });

  describe("rate limit detection in stderr", () => {
    it("rate limit message in stderr is present in error output", async () => {
      const rateLimitMsg = "Rate limit exceeded. Please wait before retrying.";
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: rateLimitMsg });

      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Rate limit");
    });

    it("rate limit message in stderr is detectable via regex", async () => {
      const rateLimitMsg = '{"error":"Rate limit exceeded","retryAfter":30}';
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: rateLimitMsg });

      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(/rate.?limit/i.test(result.error)).toBe(true);
    });
  });

  describe("stream-json output parsing", () => {
    it("extracts result text from NDJSON stream output", async () => {
      const ndjson = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"working..."}]}}',
        '{"type":"result","result":"final answer"}'
      ].join("\n");
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: ndjson });

      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.output).toBe("final answer");
    });

    it("falls back to accumulating assistant text when no result message", async () => {
      const ndjson = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"hello "}]}}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"world"}]}}'
      ].join("\n");
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: ndjson });

      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.output).toBe("hello world");
    });

    it("returns raw text when NDJSON parsing fails", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "plain text output" });

      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.output).toBe("plain text output");
    });
  });

  describe("onOutput stream-json filter", () => {
    it("wraps onOutput callback in a stream-json filter (not passed directly)", async () => {
      const onOutput = vi.fn();
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder", onOutput });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.onOutput).toBeDefined();
      expect(opts.onOutput).not.toBe(onOutput);
    });

    it("passes silenceTimeoutMs and timeout through to runCommand when streaming", async () => {
      const onOutput = vi.fn();
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({
        prompt: "test",
        role: "coder",
        onOutput,
        silenceTimeoutMs: 30000,
        timeoutMs: 120000
      });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.silenceTimeoutMs).toBe(30000);
      expect(opts.timeout).toBe(120000);
    });
  });

  describe("model configuration", () => {
    it("adds --model flag from roles config for coder", async () => {
      const config = { ...baseConfig, roles: { coder: { model: "claude-opus-4-20250514" }, reviewer: {} } };
      const agent = new ClaudeAgent("claude", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("claude-opus-4-20250514");
    });

    it("adds --model flag from roles config for reviewer", async () => {
      const config = { ...baseConfig, roles: { coder: {}, reviewer: { model: "claude-sonnet-4-20250514" } } };
      const agent = new ClaudeAgent("claude", config, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("claude-sonnet-4-20250514");
    });

    it("omits --model flag when no model is configured", async () => {
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).not.toContain("--model");
    });
  });
});
