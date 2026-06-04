// KJC-TSK-0375 — Tests for ToolCorrectnessJudgeRole (PR1).
import { describe, expect, it, vi } from "vitest";
import { ToolCorrectnessJudgeRole } from "../../src/roles/tool-correctness-judge-role.js";
import { buildToolCorrectnessJudgePrompt as build } from "../../src/prompts/tool-correctness-judge.js";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
const CALLS = [
  { tool: "Read", args: { file_path: "/tmp/a.js" } },
  { tool: "Bash", args: { command: "ls" } },
];
const mkRole = ({ output, config } = {}) => new ToolCorrectnessJudgeRole({
  config: config ?? { roles: { coder: { provider: "claude" } } }, logger: log,
  createAgentFn: () => ({ async runTask() { return { ok: true, output, usage: {} }; } }),
});
const run = (output, config) => mkRole({ output, config }).execute({ task: "t", toolCalls: CALLS });

describe("tool-correctness-judge", () => {
  it("prompt embeds preamble, task, instructions, calls and empty placeholder", () => {
    const p = build({ task: "fix X", toolCalls: CALLS, instructions: "EXTRA-Z" });
    expect(p).toContain("Karajan sub-agent");
    expect(p).toContain("EXTRA-Z");
    expect(p).toContain("fix X");
    expect(p).toContain("Read");
    expect(p).toContain("/tmp/a.js");
    expect(build({ task: "t", toolCalls: [] })).toContain("(no tool calls captured)");
  });

  it("fast-paths empty toolCalls without invoking the LLM", async () => {
    const createAgentFn = vi.fn();
    const r = new ToolCorrectnessJudgeRole({ config: {}, logger: log, createAgentFn });
    const res = await r.execute({ task: "t", toolCalls: [] });
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({ skipped: true, score: null, lowQuality: false });
    expect(res.summary).toMatch(/skipped/i);
    expect(createAgentFn).not.toHaveBeenCalled();
  });

  it("parses OK response, rounds score, OK label below threshold flips to LOW", async () => {
    const ok = await run(JSON.stringify({
      score: 88.7, summary: "fine",
      breakdown: [{ tool: "Read", args: { file_path: "x" }, correct: true, reason: "ok" }],
    }));
    expect(ok.ok).toBe(true);
    expect(ok.result).toMatchObject({ score: 89, lowQuality: false, threshold: 70 });
    expect(ok.summary).toContain("89/100");
    expect(ok.summary).toContain("OK");

    const low = await run(JSON.stringify({ score: 42, breakdown: [] }));
    expect(low.result.lowQuality).toBe(true);
    expect(low.summary).toContain("LOW");
  });

  it("honors custom threshold from config", async () => {
    const cfg = { roles: { coder: { provider: "claude" } }, pipeline: { tool_judge: { threshold: 90 } } };
    const res = await run(JSON.stringify({ score: 85, breakdown: [] }), cfg);
    expect(res.result).toMatchObject({ threshold: 90, lowQuality: true });
  });

  it("clamps score bounds and normalizes malformed breakdown", async () => {
    expect((await run(JSON.stringify({ score: 250, breakdown: [] }))).result.score).toBe(100);
    expect((await run(JSON.stringify({ score: -10, breakdown: [] }))).result.score).toBe(0);
    const res = await run(JSON.stringify({
      score: 60, breakdown: [{ tool: 123, args: null, correct: "yes", reason: 42 }, {}],
    }));
    expect(res.result.breakdown[0]).toEqual({ tool: "unknown", args: {}, correct: true, reason: "" });
    expect(res.result.breakdown[1].tool).toBe("unknown");
  });

  it("returns parse error when output is not JSON", async () => {
    const res = await run("no json here");
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/parse error/i);
  });

  it("resolveProvider walks role → reviewer → coder → claude fallback", () => {
    const cfg = (roles) => new ToolCorrectnessJudgeRole({ config: { roles }, logger: log });
    expect(cfg({ "tool-correctness-judge": { provider: "codex" }, coder: { provider: "claude" } }).resolveProvider()).toBe("codex");
    expect(cfg({ reviewer: { provider: "gemini" }, coder: { provider: "claude" } }).resolveProvider()).toBe("gemini");
    expect(new ToolCorrectnessJudgeRole({ config: {}, logger: log }).resolveProvider()).toBe("claude");
  });
});
