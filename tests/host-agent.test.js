import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HostAgent } from "../src/agents/host-agent.js";
import { detectHostAgent, isHostAgent } from "../src/utils/agent-detect.js";

describe("detectHostAgent", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("detects Claude as host", () => {
    process.env.CLAUDECODE = "1";
    expect(detectHostAgent()).toBe("claude");
  });

  it("detects Codex as host", () => {
    delete process.env.CLAUDECODE;
    delete process.env.CLAUDE_CODE;
    process.env.CODEX_CLI = "1";
    expect(detectHostAgent()).toBe("codex");
  });

  it("returns null when no host detected", () => {
    delete process.env.CLAUDECODE;
    delete process.env.CLAUDE_CODE;
    delete process.env.CODEX_CLI;
    delete process.env.CODEX;
    delete process.env.GEMINI_CLI;
    delete process.env.OPENCODE;
    expect(detectHostAgent()).toBeNull();
  });
});

describe("isHostAgent", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns true when provider matches host", () => {
    process.env.CLAUDECODE = "1";
    expect(isHostAgent("claude")).toBe(true);
  });

  it("returns false when provider differs from host", () => {
    process.env.CLAUDECODE = "1";
    expect(isHostAgent("codex")).toBe(false);
  });

  it("returns false when not inside any host", () => {
    delete process.env.CLAUDECODE;
    delete process.env.CLAUDE_CODE;
    expect(isHostAgent("claude")).toBe(false);
  });
});

describe("HostAgent", () => {
  let logger;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), setContext: vi.fn() };
  });

  it("delegates prompt to askHost and returns result", async () => {
    const askHost = vi.fn().mockResolvedValue("Code implemented successfully");
    const agent = new HostAgent({}, logger, { askHost });

    const result = await agent.runTask({ prompt: "Write a function", role: "coder" });

    expect(askHost).toHaveBeenCalledWith("Write a function");
    expect(result.ok).toBe(true);
    expect(result.output).toBe("Code implemented successfully");
  });

  it("returns error when askHost returns null", async () => {
    const askHost = vi.fn().mockResolvedValue(null);
    const agent = new HostAgent({}, logger, { askHost });

    const result = await agent.runTask({ prompt: "Write code" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("declined");
  });

  it("returns error when no askHost callback", async () => {
    const agent = new HostAgent({}, logger, { askHost: null });

    const result = await agent.runTask({ prompt: "Write code" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("no askHost");
  });

  it("calls onOutput callbacks when provided", async () => {
    const askHost = vi.fn().mockResolvedValue("Done");
    const onOutput = vi.fn();
    const agent = new HostAgent({}, logger, { askHost });

    await agent.runTask({ prompt: "Task", onOutput });

    expect(onOutput).toHaveBeenCalledTimes(2);
    expect(onOutput.mock.calls[0][0].line).toContain("Delegating");
    expect(onOutput.mock.calls[1][0].line).toContain("completed");
  });
});
