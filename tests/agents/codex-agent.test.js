import { describe, expect, it, vi, beforeEach } from "vitest";
import { createNoopLogger } from "../_fixtures/loggers.js";

vi.mock("../../src/utils/process.js", () => ({ runCommand: vi.fn() }));
vi.mock("../../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/local/bin/${name}`)
}));

const baseConfig = { roles: { coder: {}, reviewer: {} }, coder_options: {}, reviewer_options: {} };
const logger = createNoopLogger();

describe("CodexAgent", () => {
  let runCommand;
  let CodexAgent;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ runCommand } = await import("../../src/utils/process.js"));
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "" });
    ({ CodexAgent } = await import("../../src/agents/codex-agent.js"));
  });

  // merged-from: 3 buildArgs tests collapsed into one assertion bundle.
  describe("buildArgs — exec command structure", () => {
    it("exec subcommand, '-' tail, prompt via stdin input", async () => {
      const agent = new CodexAgent("codex", baseConfig, logger);
      await agent.runTask({ prompt: "implement feature", role: "coder" });

      const [, args, opts] = runCommand.mock.calls[0];
      expect(args[0]).toBe("exec");
      expect(args[args.length - 1]).toBe("-");
      expect(opts.input).toBe("implement feature");
    });
  });

  // merged-from: 4 --full-auto tests covering coder vs reviewer × on/off/missing.
  describe("--full-auto flag", () => {
    it.each([
      ["coder, auto_approve=true",  { coder_options: { auto_approve: true } },  "runTask",    true],
      ["coder, auto_approve=false", { coder_options: { auto_approve: false } }, "runTask",    false],
      ["reviewer w/ coder auto",    { coder_options: { auto_approve: true } },  "reviewTask", false],
      ["coder_options missing",     {},                                          "runTask",    false]
    ])("%s → flag=%s", async (_n, override, method, expected) => {
      const config = { ...baseConfig, ...override };
      const agent = new CodexAgent("codex", config, logger);
      await agent[method]({ prompt: "t", role: method === "runTask" ? "coder" : "reviewer" });

      const args = runCommand.mock.calls[0][1];
      if (expected) expect(args).toContain("--full-auto");
      else expect(args).not.toContain("--full-auto");
    });
  });

  // merged-from: 3 exit-code tests (success, non-zero, killed-143).
  describe("exit code handling", () => {
    it.each([
      [0,   "success", "",              { ok: true,  output: "success", error: "" }],
      [1,   "",        "command failed", { ok: false, output: "",        error: "command failed" }],
      [143, "partial", "killed",        { ok: false, output: "partial", error: "killed" }]
    ])("exit=%i → ok=%s", async (exitCode, stdout, stderr, expected) => {
      runCommand.mockResolvedValue({ exitCode, stdout, stderr });
      const result = await new CodexAgent("codex", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(result.ok).toBe(expected.ok);
      expect(result.output).toBe(expected.output);
      expect(result.error).toBe(expected.error);
      expect(result.exitCode).toBe(exitCode);
    });
  });

  // merged-from: 3 model-config tests (coder/reviewer/none).
  describe("model configuration", () => {
    const cfg = (role, model) => ({ ...baseConfig, roles: { coder: {}, reviewer: {}, [role]: { model } } });
    it.each([
      ["coder",    "runTask",    "o3"],
      ["reviewer", "reviewTask", "o4-mini"]
    ])("%s configures --model %s", async (role, method, model) => {
      const agent = new CodexAgent("codex", cfg(role, model), logger);
      await agent[method]({ prompt: "t", role });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain(model);
    });

    it("omits --model when no model is configured", async () => {
      await new CodexAgent("codex", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(runCommand.mock.calls[0][1]).not.toContain("--model");
    });
  });

  describe("reviewTask structure", () => {
    it("uses exec subcommand with stdin and forwards stdout/stderr", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "review result", stderr: "warnings" });
      const result = await new CodexAgent("codex", baseConfig, logger).reviewTask({ prompt: "review code", role: "reviewer" });

      const [, args, opts] = runCommand.mock.calls[0];
      expect(args[0]).toBe("exec");
      expect(args[args.length - 1]).toBe("-");
      expect(opts.input).toBe("review code");
      expect(result.output).toBe("review result");
      expect(result.error).toBe("warnings");
    });
  });

  it("passes onOutput, silenceTimeoutMs, and timeout to runCommand", async () => {
    const onOutput = vi.fn();
    await new CodexAgent("codex", baseConfig, logger).runTask({
      prompt: "t", role: "coder", onOutput, silenceTimeoutMs: 20000, timeoutMs: 60000
    });

    const opts = runCommand.mock.calls[0][2];
    expect(opts.onOutput).toBe(onOutput);
    expect(opts.silenceTimeoutMs).toBe(20000);
    expect(opts.timeout).toBe(60000);
  });

  // merged-from: 4 model-not-supported fallback tests collapsed to the 4
  // distinct branches: retry runTask, retry reviewTask, no retry on
  // unrelated error, no retry without custom model.
  describe("model-not-supported fallback", () => {
    const NOT_SUPPORTED = "The 'X' model is not supported when using Codex with a ChatGPT account.";

    it("retries runTask without --model when model is not supported", async () => {
      const config = { ...baseConfig, roles: { coder: { model: "o4-mini" }, reviewer: {} } };
      runCommand
        .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: NOT_SUPPORTED.replace("X", "o4-mini") })
        .mockResolvedValueOnce({ exitCode: 0, stdout: "done", stderr: "" });

      const result = await new CodexAgent("codex", config, logger).runTask({ prompt: "t", role: "coder" });

      expect(result.ok).toBe(true);
      expect(runCommand).toHaveBeenCalledTimes(2);
      const retryArgs = runCommand.mock.calls[1][1];
      expect(retryArgs).not.toContain("--model");
      expect(retryArgs).not.toContain("o4-mini");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("o4-mini"));
    });

    it("retries reviewTask without --model when model is not supported", async () => {
      const config = { ...baseConfig, roles: { coder: {}, reviewer: { model: "o3" } } };
      runCommand
        .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: NOT_SUPPORTED.replace("X", "o3") })
        .mockResolvedValueOnce({ exitCode: 0, stdout: "review ok", stderr: "" });

      const result = await new CodexAgent("codex", config, logger).reviewTask({ prompt: "r", role: "reviewer" });

      expect(result.ok).toBe(true);
      expect(runCommand).toHaveBeenCalledTimes(2);
      expect(runCommand.mock.calls[1][1]).not.toContain("--model");
    });

    it.each([
      ["unrelated error",     { ...baseConfig, roles: { coder: { model: "o4-mini" }, reviewer: {} } }, "connection timeout"],
      ["no custom model set", baseConfig,                                                              "model is not supported"]
    ])("does NOT retry: %s", async (_n, config, stderr) => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr });
      const result = await new CodexAgent("codex", config, logger).runTask({ prompt: "t", role: "coder" });

      expect(result.ok).toBe(false);
      expect(runCommand).toHaveBeenCalledTimes(1);
    });
  });

  // merged-from: 5 token-extraction tests collapsed into a single it.each
  // covering: comma sep, no commas, missing footer, reviewTask, very large.
  describe("token usage extraction", () => {
    it.each([
      ["with commas",        "runTask",    "some output\ntokens used\n9,512\n",  { tokens_in: 0, tokens_out: 9512 }],
      ["without commas",     "runTask",    "done\ntokens used\n512\n",            { tokens_in: 0, tokens_out: 512 }],
      ["no token footer",    "runTask",    "just regular output",                 { tokens_in: undefined, tokens_out: undefined }],
      ["reviewTask path",    "reviewTask", "review done\ntokens used\n15,000\n",  { tokens_in: 0, tokens_out: 15000 }],
      ["large with commas",  "runTask",    "output\ntokens used\n1,234,567\n",    { tokens_in: 0, tokens_out: 1234567 }]
    ])("%s", async (_n, method, stdout, expected) => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout, stderr: "" });
      const role = method === "runTask" ? "coder" : "reviewer";
      const result = await new CodexAgent("codex", baseConfig, logger)[method]({ prompt: "t", role });

      expect(result.ok).toBe(true);
      expect(result.tokens_in).toBe(expected.tokens_in);
      expect(result.tokens_out).toBe(expected.tokens_out);
    });
  });
});
