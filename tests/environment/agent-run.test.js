// AB-D (KJC-TSK-0654): kj agent run is the brain's inter-agent bus — kj
// provides the plumbing (availability, subprocess workarounds, usage),
// the brain reads the output and decides.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirror the REAL registry shape ({name, AgentClass, ...meta} objects) —
// a string[] mock hid an .includes() bug on first write.
vi.mock("../../src/agents/index.js", () => ({
  createAgent: vi.fn(),
  getAvailableAgents: vi.fn(() =>
    ["claude", "codex", "gemini", "aider", "opencode"].map((name) => ({ name, AgentClass: class {} }))),
}));
vi.mock("../../src/utils/agent-detect.js", () => ({
  detectAvailableAgents: vi.fn(async () => [
    { name: "claude", available: true },
    { name: "codex", available: true },
    { name: "gemini", available: false },
  ]),
}));

import { agentRunCommand } from "../../src/commands/agent-run.js";
import { createAgent } from "../../src/agents/index.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("kj agent run", () => {
  beforeEach(() => { vi.clearAllMocks(); process.exitCode = 0; });

  it("runs the task on the requested agent and returns its output", async () => {
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "analysis done", tokens_out: 42 }),
    });
    const res = await agentRunCommand({ agent: "codex", task: "analyze X", config: {}, logger, flags: { json: true } });
    expect(res.ok).toBe(true);
    expect(res.agent).toBe("codex");
    expect(res.output).toBe("analysis done");
    expect(process.exitCode).toBe(0);
    // --json is a machine contract: nothing but the payload may be logged
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("agent failure → ok:false and exit 1", async () => {
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: false, output: "", error: "boom", exitCode: 2 }),
    });
    const res = await agentRunCommand({ agent: "codex", task: "t", config: {}, logger, flags: {} });
    expect(res.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("unknown agent → actionable error naming the machine's available agents", async () => {
    await expect(agentRunCommand({ agent: "cursor", task: "t", config: {}, logger, flags: {} }))
      .rejects.toThrow(/claude.*codex|available/i);
    expect(createAgent).not.toHaveBeenCalled();
  });

  it("known but unavailable agent → actionable error", async () => {
    await expect(agentRunCommand({ agent: "gemini", task: "t", config: {}, logger, flags: {} }))
      .rejects.toThrow(/not available|no está/i);
    expect(createAgent).not.toHaveBeenCalled();
  });

  it("empty task → error", async () => {
    await expect(agentRunCommand({ agent: "codex", task: "  ", config: {}, logger, flags: {} }))
      .rejects.toThrow(/task/i);
  });

  it("a crashing delegate still yields one JSON payload (never a raw exception)", async () => {
    createAgent.mockReturnValue({ runTask: vi.fn().mockRejectedValue(new Error("spawn failed")) });
    const res = await agentRunCommand({ agent: "codex", task: "t", config: {}, logger, flags: { json: true } });
    expect(res).toMatchObject({ ok: false, agent: "codex", error: "spawn failed", usage: null });
    expect(process.exitCode).toBe(1);
  });

  it("non-numeric --timeout-minutes → actionable error, agent never invoked", async () => {
    await expect(agentRunCommand({ agent: "codex", task: "t", config: {}, logger, flags: { timeoutMinutes: "foo" } }))
      .rejects.toThrow(/timeout-minutes must be a positive number/);
    expect(createAgent).not.toHaveBeenCalled();
  });
});
