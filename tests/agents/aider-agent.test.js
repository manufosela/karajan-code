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

describe("AiderAgent", () => {
  let runCommand;
  let AiderAgent;

  beforeEach(async () => {
    vi.resetAllMocks();
    const proc = await import("../../src/utils/process.js");
    runCommand = proc.runCommand;
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "" });
    const mod = await import("../../src/agents/aider-agent.js");
    AiderAgent = mod.AiderAgent;
  });

  describe("--yes flag (non-interactive mode)", () => {
    it("includes --yes flag for runTask", async () => {
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.runTask({ prompt: "add tests", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--yes");
    });

    it("includes --yes flag for reviewTask", async () => {
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--yes");
    });

    it("--yes appears before --message in args", async () => {
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args.indexOf("--yes")).toBeLessThan(args.indexOf("--message"));
    });
  });

  describe("--message flag with task prompt", () => {
    it("includes --message flag followed by the task prompt", async () => {
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.runTask({ prompt: "implement feature X", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      const msgIdx = args.indexOf("--message");
      expect(msgIdx).toBeGreaterThanOrEqual(0);
      expect(args[msgIdx + 1]).toBe("implement feature X");
    });

    it("passes prompt via --message for reviewTask too", async () => {
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.reviewTask({ prompt: "review code quality", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--message");
      expect(args).toContain("review code quality");
    });
  });

  describe("exit code handling", () => {
    it("returns ok: true on exit code 0", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "changes applied", stderr: "" });
      const agent = new AiderAgent("aider", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.ok).toBe(true);
      expect(result.output).toBe("changes applied");
    });

    it("returns ok: false on non-zero exit code", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "aider error" });
      const agent = new AiderAgent("aider", baseConfig, logger);
      const result = await agent.runTask({ prompt: "fail", role: "coder" });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("aider error");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("model configuration", () => {
    it("adds --model when configured", async () => {
      const config = { ...baseConfig, roles: { coder: { model: "gpt-4o" }, reviewer: {} } };
      const agent = new AiderAgent("aider", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("gpt-4o");
    });

    it("--model appears after --message in args", async () => {
      const config = { ...baseConfig, roles: { coder: { model: "gpt-4o" }, reviewer: {} } };
      const agent = new AiderAgent("aider", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args.indexOf("--model")).toBeGreaterThan(args.indexOf("--message"));
    });

    it("omits --model when not configured", async () => {
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).not.toContain("--model");
    });
  });

  describe("no special stdin/env handling (unlike Claude)", () => {
    it("does NOT set stdin to 'ignore'", async () => {
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.stdin).toBeUndefined();
    });
  });

  describe("stdout/stderr mapping", () => {
    it("maps stdout to output and stderr to error", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "result text", stderr: "warnings" });
      const agent = new AiderAgent("aider", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.output).toBe("result text");
      expect(result.error).toBe("warnings");
    });
  });

  describe("timeout and streaming passthrough", () => {
    it("passes onOutput, silenceTimeoutMs, and timeout to runCommand", async () => {
      const onOutput = vi.fn();
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.runTask({
        prompt: "test",
        role: "coder",
        onOutput,
        silenceTimeoutMs: 25000,
        timeoutMs: 80000
      });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.onOutput).toBe(onOutput);
      expect(opts.silenceTimeoutMs).toBe(25000);
      expect(opts.timeout).toBe(80000);
    });
  });
});
