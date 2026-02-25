import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/local/bin/${name}`)
}));

const baseConfig = {
  session: { max_iteration_minutes: 10 },
  roles: { coder: { model: null }, reviewer: { model: null } },
  coder_options: { auto_approve: false },
  reviewer_options: {}
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe("Agent implementations", () => {
  let runCommand;

  beforeEach(async () => {
    vi.resetAllMocks();
    const proc = await import("../src/utils/process.js");
    runCommand = proc.runCommand;
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "output", stderr: "" });
  });

  describe("ClaudeAgent", () => {
    it("runs task with claude -p and prompt", async () => {
      const { ClaudeAgent } = await import("../src/agents/claude-agent.js");
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      expect(runCommand).toHaveBeenCalledWith(
        "/usr/local/bin/claude",
        ["-p", "fix bug"],
        expect.objectContaining({ timeout: 600000 })
      );
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

    it("reviews task with --output-format json", async () => {
      const { ClaudeAgent } = await import("../src/agents/claude-agent.js");
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.reviewTask({ prompt: "review code", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
    });

    it("returns ok=false on non-zero exit", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "error" });
      const { ClaudeAgent } = await import("../src/agents/claude-agent.js");
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const result = await agent.runTask({ prompt: "fail", role: "coder" });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toBe("error");
    });

    it("passes onOutput callback to runCommand", async () => {
      const { ClaudeAgent } = await import("../src/agents/claude-agent.js");
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      const onOutput = vi.fn();
      await agent.runTask({ prompt: "work", role: "coder", onOutput });

      expect(runCommand).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ onOutput })
      );
    });
  });

  describe("CodexAgent", () => {
    it("runs task with codex exec and prompt as last arg", async () => {
      const { CodexAgent } = await import("../src/agents/codex-agent.js");
      const agent = new CodexAgent("codex", baseConfig, logger);
      await agent.runTask({ prompt: "add tests", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args[0]).toBe("exec");
      expect(args[args.length - 1]).toBe("add tests");
    });

    it("adds --full-auto when auto_approve is enabled", async () => {
      const { CodexAgent } = await import("../src/agents/codex-agent.js");
      const config = { ...baseConfig, coder_options: { auto_approve: true } };
      const agent = new CodexAgent("codex", config, logger);
      await agent.runTask({ prompt: "work", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--full-auto");
    });

    it("does not add --full-auto for reviewer role", async () => {
      const { CodexAgent } = await import("../src/agents/codex-agent.js");
      const config = { ...baseConfig, coder_options: { auto_approve: true } };
      const agent = new CodexAgent("codex", config, logger);
      await agent.reviewTask({ prompt: "review", role: "reviewer" });

      const args = runCommand.mock.calls[0][1];
      expect(args).not.toContain("--full-auto");
    });

    it("adds --model flag when configured", async () => {
      const { CodexAgent } = await import("../src/agents/codex-agent.js");
      const config = { ...baseConfig, roles: { coder: { model: "o3-mini" }, reviewer: {} } };
      const agent = new CodexAgent("codex", config, logger);
      await agent.runTask({ prompt: "work", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("o3-mini");
    });

    it("returns structured result", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "warn" });
      const { CodexAgent } = await import("../src/agents/codex-agent.js");
      const agent = new CodexAgent("codex", baseConfig, logger);
      const result = await agent.runTask({ prompt: "work", role: "coder" });

      expect(result).toEqual({ ok: true, output: "done", error: "warn", exitCode: 0 });
    });
  });

  describe("GeminiAgent", () => {
    it("runs task with gemini -p and prompt", async () => {
      const { GeminiAgent } = await import("../src/agents/gemini-agent.js");
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.runTask({ prompt: "refactor", role: "coder" });

      expect(runCommand).toHaveBeenCalledWith(
        "/usr/local/bin/gemini",
        ["-p", "refactor"],
        expect.objectContaining({ timeout: 600000 })
      );
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
      const { GeminiAgent } = await import("../src/agents/gemini-agent.js");
      const config = { ...baseConfig, roles: { coder: { model: "gemini-2.5-pro" }, reviewer: {} } };
      const agent = new GeminiAgent("gemini", config, logger);
      await agent.runTask({ prompt: "work", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("gemini-2.5-pro");
    });
  });

  describe("AiderAgent", () => {
    it("runs task with aider --yes --message", async () => {
      const { AiderAgent } = await import("../src/agents/aider-agent.js");
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.runTask({ prompt: "fix issue", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--yes");
      expect(args).toContain("--message");
      expect(args).toContain("fix issue");
    });

    it("reviews with same --yes --message pattern", async () => {
      const { AiderAgent } = await import("../src/agents/aider-agent.js");
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.reviewTask({ prompt: "review code" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--yes");
      expect(args).toContain("--message");
      expect(args).toContain("review code");
    });

    it("adds model when configured", async () => {
      const { AiderAgent } = await import("../src/agents/aider-agent.js");
      const config = { ...baseConfig, roles: { coder: { model: "gpt-4-turbo" }, reviewer: {} } };
      const agent = new AiderAgent("aider", config, logger);
      await agent.runTask({ prompt: "work", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("gpt-4-turbo");
    });
  });
});
