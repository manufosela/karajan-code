import { describe, expect, it, vi, beforeEach } from "vitest";
import { createNoopLogger } from "../_fixtures/loggers.js";
import { baseAgentConfig } from "../_fixtures/agents.js";

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/local/bin/${name}`)
}));

const baseConfig = baseAgentConfig();
const logger = createNoopLogger();

describe("CopilotAgent", () => {
  let runCommand;
  let CopilotAgent;

  beforeEach(async () => {
    vi.resetAllMocks();
    const proc = await import("../../src/utils/process.js");
    runCommand = proc.runCommand;
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "" });
    const mod = await import("../../src/agents/copilot-agent.js");
    CopilotAgent = mod.CopilotAgent;
  });

  describe("non-interactive surface (runTask & reviewTask)", () => {
    it.each([
      ["runTask",    "coder",    "fix bug",     false],
      ["reviewTask", "reviewer", "review code", true]
    ])("%s: passes -p prompt, -s, --allow-all-tools, --no-ask-user, json=%s", async (method, role, prompt, expectsJson) => {
      const agent = new CopilotAgent("copilot", baseConfig, logger);
      await agent[method]({ prompt, role });

      const [, args, opts] = runCommand.mock.calls[0];
      expect(args[0]).toBe("-p");
      expect(args[1]).toBe(prompt);
      expect(args).toContain("-s");
      expect(args).toContain("--allow-all-tools");
      expect(args).toContain("--no-ask-user");
      expect(opts.input).toBeUndefined();
      if (expectsJson) {
        expect(args).toContain("--output-format");
        expect(args).toContain("json");
      } else {
        expect(args).not.toContain("--output-format");
      }
    });
  });

  describe("model configuration", () => {
    const cfg = (role, model) => ({ ...baseConfig, roles: { coder: {}, reviewer: {}, [role]: { model } } });
    it("adds --model when configured, omits it otherwise", async () => {
      await new CopilotAgent("copilot", cfg("coder", "claude-sonnet-4.5"), logger).runTask({ prompt: "p", role: "coder" });
      expect(runCommand.mock.calls[0][1]).toContain("--model");
      expect(runCommand.mock.calls[0][1]).toContain("claude-sonnet-4.5");
      vi.resetAllMocks();
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "" });
      await new CopilotAgent("copilot", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(runCommand.mock.calls[0][1]).not.toContain("--model");
    });
  });

  describe("exit code handling", () => {
    it.each([
      [0, "success", "",      { ok: true,  output: "success", error: "",      exitCode: 0 }],
      [1, "",        "error", { ok: false, output: "",        error: "error", exitCode: 1 }]
    ])("exit=%i reflects ok+output+error", async (exitCode, stdout, stderr, expected) => {
      runCommand.mockResolvedValue({ exitCode, stdout, stderr });
      const result = await new CopilotAgent("copilot", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(result).toEqual(expected);
    });
  });

  // JSONL: the final answer is the last assistant.message content; outputTokens
  // sum to tokens_out (Copilot reports no prompt tokens, so tokens_in stays 0).
  describe("JSON output parsing (reviewTask)", () => {
    it("extracts assistant.message content and outputTokens", async () => {
      const stdout = [
        '{"type":"user.message","data":{"content":"r"}}',
        '{"type":"assistant.message","data":{"content":"looks good","outputTokens":33}}',
        '{"type":"result","sessionId":"abc","exitCode":0,"usage":{"premiumRequests":1}}'
      ].join("\n");
      runCommand.mockResolvedValue({ exitCode: 0, stdout, stderr: "" });
      const result = await new CopilotAgent("copilot", baseConfig, logger).reviewTask({ prompt: "r", role: "reviewer" });
      expect(result.output).toBe("looks good");
      expect(result.tokens_out).toBe(33);
      expect(result.tokens_in).toBe(0);
    });

    it("leaves usage undefined on plain runTask output", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "plain\n", stderr: "" });
      const result = await new CopilotAgent("copilot", baseConfig, logger).runTask({ prompt: "t", role: "coder" });
      expect(result.tokens_out).toBeUndefined();
    });
  });
});
