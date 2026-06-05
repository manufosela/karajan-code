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

  // merged-from: 5 --yes/--message arg tests collapsed. Both run/review
  // emit `--yes` then `--message <prompt>`; positional contract identical.
  describe("--yes + --message arg contract", () => {
    it.each([
      ["runTask",    "coder",    "implement feature X"],
      ["reviewTask", "reviewer", "review code quality"]
    ])("%s emits --yes before --message <prompt>", async (method, role, prompt) => {
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent[method]({ prompt, role });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--yes");
      const msgIdx = args.indexOf("--message");
      expect(msgIdx).toBeGreaterThanOrEqual(0);
      expect(args[msgIdx + 1]).toBe(prompt);
      expect(args.indexOf("--yes")).toBeLessThan(msgIdx);
    });
  });

  // merged-from: 2 exit-code tests collapsed (ok=true on 0 / ok=false on 1).
  describe("exit code handling", () => {
    it.each([
      [0, "changes applied", "",            { ok: true,  output: "changes applied", error: "",            exitCode: 0 }],
      [1, "",                "aider error", { ok: false, output: "",                error: "aider error", exitCode: 1 }]
    ])("exit=%i → ok=%s", async (exitCode, stdout, stderr, expected) => {
      runCommand.mockResolvedValue({ exitCode, stdout, stderr });
      const agent = new AiderAgent("aider", baseConfig, logger);
      const result = await agent.runTask({ prompt: "test", role: "coder" });
      expect(result).toEqual(expected);
    });
  });

  // merged-from: 3 --model tests collapsed (configured / order vs --message / omitted).
  describe("model configuration", () => {
    it("adds --model after --message when configured", async () => {
      const config = { ...baseConfig, roles: { coder: { model: "gpt-4o" }, reviewer: {} } };
      const agent = new AiderAgent("aider", config, logger);
      await agent.runTask({ prompt: "test", role: "coder" });

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--model");
      expect(args).toContain("gpt-4o");
      expect(args.indexOf("--model")).toBeGreaterThan(args.indexOf("--message"));
    });

    it("omits --model when not configured", async () => {
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.runTask({ prompt: "test", role: "coder" });
      expect(runCommand.mock.calls[0][1]).not.toContain("--model");
    });
  });

  it("does NOT set stdin to 'ignore' (unlike Claude)", async () => {
    const agent = new AiderAgent("aider", baseConfig, logger);
    await agent.runTask({ prompt: "test", role: "coder" });
    expect(runCommand.mock.calls[0][2].stdin).toBeUndefined();
  });

  it("maps stdout to output and stderr to error", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "result text", stderr: "warnings" });
    const result = await new AiderAgent("aider", baseConfig, logger).runTask({ prompt: "test", role: "coder" });
    expect(result.output).toBe("result text");
    expect(result.error).toBe("warnings");
  });

  it("forwards onOutput, silenceTimeoutMs and timeout to runCommand", async () => {
    const onOutput = vi.fn();
    await new AiderAgent("aider", baseConfig, logger).runTask({
      prompt: "test", role: "coder", onOutput, silenceTimeoutMs: 25000, timeoutMs: 80000
    });

    const opts = runCommand.mock.calls[0][2];
    expect(opts.onOutput).toBe(onOutput);
    expect(opts.silenceTimeoutMs).toBe(25000);
    expect(opts.timeout).toBe(80000);
  });
});
