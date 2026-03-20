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

  describe("runTask args", () => {
    it("starts with 'run' subcommand", async () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args[0]).toBe("run");
    });

    it("puts the prompt as the last argument", async () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({ prompt: "implement feature", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args[args.length - 1]).toBe("implement feature");
    });

    it("does NOT use stdin for prompt (unlike Codex)", async () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.input).toBeUndefined();
    });
  });

  describe("reviewTask args", () => {
    it("starts with 'run' subcommand for review too", async () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.reviewTask({ prompt: "review code", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args[0]).toBe("run");
    });

    it("includes --format json for reviewTask", async () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--format");
      expect(args).toContain("json");
    });

    it("does NOT include --format json for runTask", async () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).not.toContain("--format");
    });

    it("puts prompt as last argument in reviewTask", async () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.reviewTask({ prompt: "review this", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args[args.length - 1]).toBe("review this");
    });
  });

  describe("model configuration", () => {
    it("adds --model when configured for coder role", async () => {
      const config = { ...baseConfig, roles: { coder: { model: "anthropic/claude-3-5-sonnet" }, reviewer: {} } };
      const agent = new OpenCodeAgent("opencode", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("anthropic/claude-3-5-sonnet");
    });

    it("adds --model when configured for reviewer role", async () => {
      const config = { ...baseConfig, roles: { coder: {}, reviewer: { model: "openai/gpt-4o" } } };
      const agent = new OpenCodeAgent("opencode", config, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("openai/gpt-4o");
    });

    it("--model appears before prompt in args", async () => {
      const config = { ...baseConfig, roles: { coder: { model: "test-model" }, reviewer: {} } };
      const agent = new OpenCodeAgent("opencode", config, logger);
      await agent.runTask({ prompt: "do work", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args.indexOf("--model")).toBeLessThan(args.indexOf("do work"));
    });

    it("omits --model when not configured", async () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).not.toContain("--model");
    });
  });

  describe("exit code handling", () => {
    it("returns ok: true on exit code 0", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "success", stderr: "" });
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result).toEqual({ ok: true, output: "success", error: "", exitCode: 0 });
    });

    it("returns ok: false on non-zero exit code", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "error" });
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      const result = await agent.runTask({ prompt: "fail", role: "coder" });

      expect(result).toEqual({ ok: false, output: "", error: "error", exitCode: 1 });
    });
  });

  describe("no special stdin/env handling", () => {
    it("does NOT set stdin to 'ignore'", async () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.stdin).toBeUndefined();
    });

    it("does NOT strip env vars", async () => {
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.env).toBeUndefined();
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
});
