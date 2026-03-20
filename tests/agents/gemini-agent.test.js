import { describe, expect, it, vi, beforeEach } from "vitest";

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

  describe("buildArgs — -p flag", () => {
    it("includes -p flag followed by the task prompt", async () => {
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.runTask({ prompt: "build feature", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      const pIdx = args.indexOf("-p");
      expect(pIdx).toBeGreaterThanOrEqual(0);
      expect(args[pIdx + 1]).toBe("build feature");
    });

    it("uses -p for reviewTask too", async () => {
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.reviewTask({ prompt: "review code", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("-p");
      expect(args).toContain("review code");
    });
  });

  describe("output format", () => {
    it("does NOT set --output-format for runTask (plain mode)", async () => {
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).not.toContain("--output-format");
    });

    it("sets --output-format json for reviewTask", async () => {
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      const fmtIdx = args.indexOf("--output-format");
      expect(fmtIdx).toBeGreaterThanOrEqual(0);
      expect(args[fmtIdx + 1]).toBe("json");
    });
  });

  describe("exit code handling", () => {
    it("returns ok: true on exit code 0", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "" });
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.ok).toBe(true);
      expect(result.output).toBe("done");
    });

    it("returns ok: false on non-zero exit code", async () => {
      runCommand.mockResolvedValue({ exitCode: 2, stdout: "", stderr: "crash" });
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(2);
      expect(result.error).toBe("crash");
    });
  });

  describe("model configuration", () => {
    it("adds --model when configured for coder role", async () => {
      const config = { ...baseConfig, roles: { coder: { model: "gemini-2.5-pro" }, reviewer: {} } };
      const agent = new GeminiAgent("gemini", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("gemini-2.5-pro");
    });

    it("adds --model when configured for reviewer role", async () => {
      const config = { ...baseConfig, roles: { coder: {}, reviewer: { model: "gemini-2.5-flash" } } };
      const agent = new GeminiAgent("gemini", config, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("gemini-2.5-flash");
    });

    it("omits --model when no model configured", async () => {
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).not.toContain("--model");
    });
  });

  describe("no special stdin/env handling (unlike Claude)", () => {
    it("does NOT set stdin to 'ignore'", async () => {
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.stdin).toBeUndefined();
    });

    it("does NOT strip env vars", async () => {
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.env).toBeUndefined();
    });
  });

  describe("returns stdout/stderr directly (no pickOutput)", () => {
    it("uses stdout as output, stderr as error", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "response", stderr: "warn" });
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.output).toBe("response");
      expect(result.error).toBe("warn");
    });
  });

  describe("timeout and streaming passthrough", () => {
    it("passes onOutput, silenceTimeoutMs, and timeout to runCommand", async () => {
      const onOutput = vi.fn();
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.runTask({
        prompt: "test",
        role: "coder",
        onOutput,
        silenceTimeoutMs: 15000,
        timeoutMs: 90000
      });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.onOutput).toBe(onOutput);
      expect(opts.silenceTimeoutMs).toBe(15000);
      expect(opts.timeout).toBe(90000);
    });
  });
});
