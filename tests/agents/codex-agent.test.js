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

describe("CodexAgent", () => {
  let runCommand;
  let CodexAgent;

  beforeEach(async () => {
    vi.resetAllMocks();
    const proc = await import("../../src/utils/process.js");
    runCommand = proc.runCommand;
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "" });
    const mod = await import("../../src/agents/codex-agent.js");
    CodexAgent = mod.CodexAgent;
  });

  describe("buildArgs — exec command structure", () => {
    it("starts args with 'exec' subcommand", async () => {
      const agent = new CodexAgent("codex", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args[0]).toBe("exec");
    });

    it("ends args with '-' to read prompt from stdin", async () => {
      const agent = new CodexAgent("codex", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args[args.length - 1]).toBe("-");
    });

    it("passes task prompt via input option (stdin)", async () => {
      const agent = new CodexAgent("codex", baseConfig, logger);
      await agent.runTask({ prompt: "implement feature", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.input).toBe("implement feature");
    });
  });

  describe("--full-auto flag", () => {
    it("adds --full-auto when auto_approve is enabled for coder", async () => {
      const config = { ...baseConfig, coder_options: { auto_approve: true } };
      const agent = new CodexAgent("codex", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      expect(runCommand.mock.calls[0][1]).toContain("--full-auto");
    });

    it("does NOT add --full-auto when auto_approve is false", async () => {
      const config = { ...baseConfig, coder_options: { auto_approve: false } };
      const agent = new CodexAgent("codex", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      expect(runCommand.mock.calls[0][1]).not.toContain("--full-auto");
    });

    it("does NOT add --full-auto for reviewer role (even if auto_approve is on)", async () => {
      const config = { ...baseConfig, coder_options: { auto_approve: true } };
      const agent = new CodexAgent("codex", config, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      expect(runCommand.mock.calls[0][1]).not.toContain("--full-auto");
    });

    it("does NOT add --full-auto when coder_options is missing", async () => {
      const config = { roles: { coder: {}, reviewer: {} } };
      const agent = new CodexAgent("codex", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      expect(runCommand.mock.calls[0][1]).not.toContain("--full-auto");
    });
  });

  describe("exit code handling", () => {
    it("returns ok: true on exit code 0", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "success", stderr: "" });
      const agent = new CodexAgent("codex", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.ok).toBe(true);
      expect(result.output).toBe("success");
      expect(result.exitCode).toBe(0);
    });

    it("returns ok: false on non-zero exit code", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "command failed" });
      const agent = new CodexAgent("codex", baseConfig, logger);
      const result = await agent.runTask({ prompt: "fail", role: "coder" });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("command failed");
      expect(result.exitCode).toBe(1);
    });

    it("returns ok: false for exit code 143 (killed)", async () => {
      runCommand.mockResolvedValue({ exitCode: 143, stdout: "partial", stderr: "killed" });
      const agent = new CodexAgent("codex", baseConfig, logger);
      const result = await agent.runTask({ prompt: "timeout", role: "coder" });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(143);
    });
  });

  describe("model configuration", () => {
    it("adds --model flag when model is configured for coder", async () => {
      const config = { ...baseConfig, roles: { coder: { model: "o3" }, reviewer: {} } };
      const agent = new CodexAgent("codex", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("o3");
    });

    it("adds --model flag for reviewer when configured", async () => {
      const config = { ...baseConfig, roles: { coder: {}, reviewer: { model: "o4-mini" } } };
      const agent = new CodexAgent("codex", config, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("o4-mini");
    });

    it("omits --model flag when no model is configured", async () => {
      const agent = new CodexAgent("codex", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).not.toContain("--model");
    });
  });

  describe("reviewTask structure", () => {
    it("uses exec subcommand with stdin for review too", async () => {
      const agent = new CodexAgent("codex", baseConfig, logger);
      await agent.reviewTask({ prompt: "review code", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args[0]).toBe("exec");
      expect(args[args.length - 1]).toBe("-");
      expect(runCommand.mock.calls[0][2].input).toBe("review code");
    });

    it("returns stdout as output and stderr as error", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "review result", stderr: "warnings" });
      const agent = new CodexAgent("codex", baseConfig, logger);
      const result = await agent.reviewTask({ prompt: "review", role: "reviewer" });

      expect(result.output).toBe("review result");
      expect(result.error).toBe("warnings");
    });
  });

  describe("timeout and streaming options passthrough", () => {
    it("passes onOutput, silenceTimeoutMs, and timeout to runCommand", async () => {
      const onOutput = vi.fn();
      const agent = new CodexAgent("codex", baseConfig, logger);
      await agent.runTask({
        prompt: "test",
        role: "coder",
        onOutput,
        silenceTimeoutMs: 20000,
        timeoutMs: 60000
      });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.onOutput).toBe(onOutput);
      expect(opts.silenceTimeoutMs).toBe(20000);
      expect(opts.timeout).toBe(60000);
    });
  });
});
