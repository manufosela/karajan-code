import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/local/bin/${name}`)
}));

const baseConfig = {
  roles: { coder: {}, reviewer: {} },
  coder_options: {},
  reviewer_options: {}
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("Agent implementations", () => {
  let runCommand;

  beforeEach(async () => {
    vi.resetAllMocks();
    const proc = await import("../src/utils/process.js");
    runCommand = proc.runCommand;
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "output", stderr: "" });
  });

  describe("ClaudeAgent", () => {
    it("runs task with claude -p and --output-format json (no streaming without onOutput)", async () => {
      const { ClaudeAgent } = await import("../src/agents/claude-agent.js");
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("-p");
      expect(args).toContain("fix bug");
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
      expect(runCommand.mock.calls[0][2]).toMatchObject({
        env: expect.any(Object),
        stdin: "ignore"
      });
    });

    it("adds --model flag when model is configured", async () => {
      const { ClaudeAgent } = await import("../src/agents/claude-agent.js");
      const config = { ...baseConfig, roles: { coder: { model: "opus" }, reviewer: {} } };
      const agent = new ClaudeAgent("claude", config, logger);
      await agent.runTask({ prompt: "fix", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("opus");
    });

    it("reviews task with --output-format stream-json and --verbose", async () => {
      const { ClaudeAgent } = await import("../src/agents/claude-agent.js");
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.reviewTask({ prompt: "review code", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--output-format");
      expect(args).toContain("stream-json");
      expect(args).toContain("--verbose");
    });

    it("returns ok=false on non-zero exit with error from stderr", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "error detail" });
      const { ClaudeAgent } = await import("../src/agents/claude-agent.js");
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "fail", role: "coder" });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("error detail");
    });

    it("uses stream-json with --verbose and wraps onOutput when callback is provided", async () => {
      const { ClaudeAgent } = await import("../src/agents/claude-agent.js");
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const onOutput = vi.fn();
      await agent.runTask({ prompt: "work", role: "coder", onOutput });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--output-format");
      expect(args).toContain("stream-json");
      expect(args).toContain("--verbose");
      // The onOutput is wrapped in a stream-json filter, not passed directly
      expect(runCommand.mock.calls[0][2]).toHaveProperty("onOutput");
      expect(runCommand.mock.calls[0][2].onOutput).not.toBe(onOutput);
    });

    it("strips CLAUDECODE from env and ignores stdin", async () => {
      process.env.CLAUDECODE = "1";
      const { ClaudeAgent } = await import("../src/agents/claude-agent.js");
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.env).toBeDefined();
      expect(opts.env).not.toHaveProperty("CLAUDECODE");
      expect(opts.stdin).toBe("ignore");
      delete process.env.CLAUDECODE;
    });

    it("reads output from stderr when stdout is empty (Claude 2.x behavior)", async () => {
      const stderrJson = '{"type":"result","result":"PONG"}';
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: stderrJson });
      const { ClaudeAgent } = await import("../src/agents/claude-agent.js");
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });

      expect(result.ok).toBe(true);
      expect(result.output).toBe("PONG");
    });
  });

  describe("CodexAgent", () => {
    it("runs task with codex exec reading prompt from stdin", async () => {
      const { CodexAgent } = await import("../src/agents/codex-agent.js");
      const agent = new CodexAgent("codex", baseConfig, logger);
      await agent.runTask({ prompt: "add tests", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args[0]).toBe("exec");
      expect(args[args.length - 1]).toBe("-");
      expect(runCommand.mock.calls[0][2]).toMatchObject({ input: "add tests" });
    });

    it("adds --full-auto when auto_approve is enabled", async () => {
      const config = { ...baseConfig, coder_options: { auto_approve: true } };
      const { CodexAgent } = await import("../src/agents/codex-agent.js");
      const agent = new CodexAgent("codex", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      expect(runCommand.mock.calls[0][1]).toContain("--full-auto");
    });

    it("does not add --full-auto for reviewer role", async () => {
      const config = { ...baseConfig, coder_options: { auto_approve: true } };
      const { CodexAgent } = await import("../src/agents/codex-agent.js");
      const agent = new CodexAgent("codex", config, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      expect(runCommand.mock.calls[0][1]).not.toContain("--full-auto");
    });

    it("adds --model flag when configured", async () => {
      const config = { ...baseConfig, roles: { coder: { model: "o3" }, reviewer: {} } };
      const { CodexAgent } = await import("../src/agents/codex-agent.js");
      const agent = new CodexAgent("codex", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("o3");
    });

    it("returns structured result", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "" });
      const { CodexAgent } = await import("../src/agents/codex-agent.js");
      const agent = new CodexAgent("codex", baseConfig, logger);
      const result = await agent.runTask({ prompt: "task", role: "coder" });

      expect(result.ok).toBe(true);
      expect(result.output).toBe("done");
    });
  });

  describe("GeminiAgent", () => {
    it("runs task with gemini -p and prompt", async () => {
      const { GeminiAgent } = await import("../src/agents/gemini-agent.js");
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.runTask({ prompt: "build feature", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("-p");
      expect(args).toContain("build feature");
    });

    it("reviews with --output-format json", async () => {
      const { GeminiAgent } = await import("../src/agents/gemini-agent.js");
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
    });

    it("adds model when configured", async () => {
      const config = { ...baseConfig, roles: { coder: { model: "gemini-2" }, reviewer: {} } };
      const { GeminiAgent } = await import("../src/agents/gemini-agent.js");
      const agent = new GeminiAgent("gemini", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("gemini-2");
    });
  });

  describe("AiderAgent", () => {
    it("runs task with aider --yes --message", async () => {
      const { AiderAgent } = await import("../src/agents/aider-agent.js");
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.runTask({ prompt: "add feature", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--yes");
      expect(args).toContain("--message");
      expect(args).toContain("add feature");
    });

    it("reviews with same --yes --message pattern", async () => {
      const { AiderAgent } = await import("../src/agents/aider-agent.js");
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--yes");
      expect(args).toContain("--message");
    });

    it("adds model when configured", async () => {
      const config = { ...baseConfig, roles: { coder: { model: "gpt-4o" }, reviewer: {} } };
      const { AiderAgent } = await import("../src/agents/aider-agent.js");
      const agent = new AiderAgent("aider", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("gpt-4o");
    });
  });

  describe("OpenCodeAgent", () => {
    it("runs task with opencode run and prompt as argument", async () => {
      const { OpenCodeAgent } = await import("../src/agents/opencode-agent.js");
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args[0]).toBe("run");
      expect(args[args.length - 1]).toBe("fix bug");
    });

    it("adds --model flag when configured", async () => {
      const { OpenCodeAgent } = await import("../src/agents/opencode-agent.js");
      const config = { ...baseConfig, roles: { coder: { model: "anthropic/claude-3-5-sonnet" }, reviewer: {} } };
      const agent = new OpenCodeAgent("opencode", config, logger);
      await agent.runTask({ prompt: "work", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("anthropic/claude-3-5-sonnet");
    });

    it("reviews with --format json", async () => {
      const { OpenCodeAgent } = await import("../src/agents/opencode-agent.js");
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.reviewTask({ prompt: "review code", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--format");
      expect(args).toContain("json");
    });

    it("returns structured result", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "warn" });
      const { OpenCodeAgent } = await import("../src/agents/opencode-agent.js");
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      const result = await agent.runTask({ prompt: "work", role: "coder" });

      expect(result).toEqual({ ok: true, output: "done", error: "warn", exitCode: 0 });
    });
  });
});
