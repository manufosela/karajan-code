import { describe, expect, it, vi } from "vitest";
import { buildSynthesizerPrompt, synthesizeMissingTests } from "../../src/plan/tests-synthesizer.js";

describe("buildSynthesizerPrompt", () => {
  it("opens with the role hand-off so the LLM knows it's a follow-up", () => {
    const prompt = buildSynthesizerPrompt({
      task: "Build login",
      husNeedingTests: [{ id: "plan-x_001", title: "wire endpoint", scope: "POST /login" }],
    });
    expect(prompt).toMatch(/previously generated an implementation plan/);
    expect(prompt).toMatch(/Your ONLY job/);
  });

  it("documents the JSON shape with both gherkin and shell examples", () => {
    const prompt = buildSynthesizerPrompt({ task: "x", husNeedingTests: [{ id: "h1" }] });
    expect(prompt).toMatch(/"tests"/);
    expect(prompt).toMatch(/"type": "gherkin"/);
    expect(prompt).toMatch(/"type": "shell"/);
  });

  it("lists each HU id verbatim with title and scope", () => {
    const prompt = buildSynthesizerPrompt({
      task: "Build app",
      husNeedingTests: [
        { id: "plan-x_001", title: "DB migration", scope: "Add users table" },
        { id: "plan-x_002", title: "API route", scope: "POST /users" },
      ],
    });
    expect(prompt).toMatch(/### plan-x_001: DB migration/);
    expect(prompt).toMatch(/Scope: Add users table/);
    expect(prompt).toMatch(/### plan-x_002: API route/);
    expect(prompt).toMatch(/Scope: POST \/users/);
  });

  it("falls back to '(no scope)' when scope is missing", () => {
    const prompt = buildSynthesizerPrompt({
      task: "x", husNeedingTests: [{ id: "h1", title: "t" }],
    });
    expect(prompt).toMatch(/\(no scope\)/);
  });

  it("forbids the generic placeholder explicitly", () => {
    const prompt = buildSynthesizerPrompt({ task: "x", husNeedingTests: [{ id: "h1" }] });
    expect(prompt).toMatch(/Do NOT use generic fallbacks like `npx vitest run`/);
  });

  it("requires JSON-only output (no prose, no fences around it)", () => {
    const prompt = buildSynthesizerPrompt({ task: "x", husNeedingTests: [{ id: "h1" }] });
    expect(prompt).toMatch(/Return ONLY the JSON/);
  });
});

describe("synthesizeMissingTests", () => {
  it("returns empty tests + ok when there are no HUs to synthesize for", async () => {
    const agent = { runTask: vi.fn() };
    const result = await synthesizeMissingTests({ agent, task: "x", husNeedingTests: [] });
    expect(result.ok).toBe(true);
    expect(result.tests).toEqual({});
    expect(agent.runTask).not.toHaveBeenCalled();
  });

  it("parses the LLM's JSON response and returns tests keyed by HU id", async () => {
    const agent = {
      runTask: vi.fn().mockResolvedValue({
        ok: true,
        output: JSON.stringify({
          tests: {
            "plan-x_001": [
              { type: "gherkin", content: "Given a user\nWhen they POST /login\nThen 200" },
              { type: "shell", content: "curl -fsS -o /dev/null http://localhost:3000/login" },
            ],
            "plan-x_002": [
              { type: "shell", content: "test -f src/users.js" },
            ],
          },
        }),
      }),
    };
    const result = await synthesizeMissingTests({
      agent, task: "build it",
      husNeedingTests: [{ id: "plan-x_001" }, { id: "plan-x_002" }],
    });
    expect(result.ok).toBe(true);
    expect(Object.keys(result.tests).sort()).toEqual(["plan-x_001", "plan-x_002"]);
    expect(result.tests["plan-x_001"]).toHaveLength(2);
    expect(result.tests["plan-x_001"][0].type).toBe("gherkin");
  });

  it("normalises legacy plain-string tests to { type: shell, content }", async () => {
    const agent = {
      runTask: vi.fn().mockResolvedValue({
        ok: true,
        output: JSON.stringify({ tests: { h1: ["echo PASS"] } }),
      }),
    };
    const result = await synthesizeMissingTests({
      agent, task: "x", husNeedingTests: [{ id: "h1" }],
    });
    expect(result.ok).toBe(true);
    expect(result.tests.h1[0]).toEqual({ type: "shell", content: "echo PASS" });
  });

  it("drops HU keys whose tests array normalises to empty (junk-only)", async () => {
    const agent = {
      runTask: vi.fn().mockResolvedValue({
        ok: true,
        output: JSON.stringify({ tests: { h1: [null, "", { foo: "bar" }] } }),
      }),
    };
    const result = await synthesizeMissingTests({
      agent, task: "x", husNeedingTests: [{ id: "h1" }],
    });
    expect(result.ok).toBe(true);
    expect(result.tests).toEqual({});
  });

  it("returns ok:false when the agent fails", async () => {
    const agent = {
      runTask: vi.fn().mockResolvedValue({ ok: false, error: "rate limited" }),
    };
    const result = await synthesizeMissingTests({
      agent, task: "x", husNeedingTests: [{ id: "h1" }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rate limited/);
  });

  it("returns ok:false when the agent output has no tests object", async () => {
    const agent = {
      runTask: vi.fn().mockResolvedValue({ ok: true, output: '{"approach":"x"}' }),
    };
    const result = await synthesizeMissingTests({
      agent, task: "x", husNeedingTests: [{ id: "h1" }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no `tests` object/);
  });

  it("returns ok:false when the agent output is not valid JSON", async () => {
    const agent = {
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "not json at all" }),
    };
    const result = await synthesizeMissingTests({
      agent, task: "x", husNeedingTests: [{ id: "h1" }],
    });
    expect(result.ok).toBe(false);
  });

  it("forwards onOutput / silenceTimeoutMs / timeoutMs to the agent", async () => {
    const agent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: '{"tests":{}}' }) };
    const onOutput = vi.fn();
    await synthesizeMissingTests({
      agent, task: "x", husNeedingTests: [{ id: "h1" }],
      onOutput, silenceTimeoutMs: 9999, timeoutMs: 12345,
    });
    expect(agent.runTask).toHaveBeenCalledTimes(1);
    const args = agent.runTask.mock.calls[0][0];
    expect(args.onOutput).toBe(onOutput);
    expect(args.silenceTimeoutMs).toBe(9999);
    expect(args.timeoutMs).toBe(12345);
    expect(args.role).toBe("planner");
  });
});
