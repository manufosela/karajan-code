import { describe, expect, it, vi, beforeEach } from "vitest";
import { createNoopLogger } from "../_fixtures/loggers.js";

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

  // merged-from: 4 -p flag + output-format tests collapsed. Both methods pass
  // -p <prompt>; only reviewTask appends `--output-format json`.
  describe("-p flag and output format", () => {
    it.each([
      ["runTask",    "coder",    "build feature", false],
      ["reviewTask", "reviewer", "review code",   true]
    ])("%s emits -p <prompt>; --output-format json=%s", async (method, role, prompt, expectsJson) => {
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent[method]({ prompt, role });

      const args = runCommand.mock.calls[0][1];
      const pIdx = args.indexOf("-p");
      expect(pIdx).toBeGreaterThanOrEqual(0);
      expect(args[pIdx + 1]).toBe(prompt);
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

  // merged-from: 2 stdin/env tests collapsed. Gemini, like OpenCode, never
  // touches either option (unlike Claude which sets stdin=ignore + strips env).
  describe("no special stdin/env handling (unlike Claude)", () => {
    it.each([
      ["stdin", "stdin"],
      ["env",   "env"]
    ])("does NOT set %s", async (_label, optKey) => {
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });
      expect(runCommand.mock.calls[0][2][optKey]).toBeUndefined();
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
});
