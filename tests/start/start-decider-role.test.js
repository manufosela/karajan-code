import { describe, it, expect, vi } from "vitest";
import { StartDecidorRole } from "../../src/start/start-decider-role.js";

/**
 * KJC-TSK-0569 (Onboard B) — the StartDecidor role. The agent is injected
 * (createAgentFn) so the test never spawns a CLI. Asserts: valid intent passes
 * through, unknown/unparseable output degrades to ASK_USER, provider resolves.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

function roleWith(output, { config = {}, ok = true } = {}) {
  const runTask = vi.fn(async (args) => ({ ok, output, usage: {}, prompt: args.prompt }));
  const role = new StartDecidorRole({
    config: { roles: { coder: { provider: "claude" } }, ...config },
    logger,
    createAgentFn: () => ({ runTask }),
  });
  return { role, runTask };
}

describe("StartDecidorRole (KJC-TSK-0569)", () => {
  it("passes a valid intent through with its rationale", async () => {
    const { role } = roleWith('{"intent":"RECOMMEND_HARDEN","rationale":"no tests"}');
    const r = await role.execute({ userMessage: "", assessment: "Tests: no" });
    expect(r.ok).toBe(true);
    expect(r.result.intent).toBe("RECOMMEND_HARDEN");
    expect(r.result.rationale).toBe("no tests");
    expect(r.result.questionToAsk).toBe("");
  });

  it("keeps the open question when the intent is ASK_USER", async () => {
    const { role } = roleWith('{"intent":"ASK_USER","questionToAsk":"Build or fix?"}');
    const r = await role.execute({ assessment: "x" });
    expect(r.result.intent).toBe("ASK_USER");
    expect(r.result.questionToAsk).toBe("Build or fix?");
  });

  it("degrades an unknown intent to ASK_USER with a fallback question", async () => {
    const { role } = roleWith('{"intent":"LAUNCH_ROCKET"}');
    const r = await role.execute({ assessment: "x" });
    expect(r.ok).toBe(true);
    expect(r.result.intent).toBe("ASK_USER");
    expect(r.result.questionToAsk).toMatch(/\?$/);
  });

  it("degrades unparseable output to ASK_USER instead of failing", async () => {
    const { role } = roleWith("sorry, I cannot help with that");
    const r = await role.execute({ assessment: "x" });
    expect(r.ok).toBe(true);
    expect(r.result.intent).toBe("ASK_USER");
    expect(r.result.degraded).toBe(true);
  });

  it("feeds userMessage and assessment into the prompt", async () => {
    const { role, runTask } = roleWith('{"intent":"START_TASK"}');
    await role.execute({ userMessage: "add a logout button", assessment: "Maturity: existing" });
    const prompt = runTask.mock.calls[0][0].prompt;
    expect(prompt).toContain("add a logout button");
    expect(prompt).toContain("Maturity: existing");
  });

  it("resolves the start role to the coder provider when unset", () => {
    const { role } = roleWith("{}");
    expect(role.resolveProvider()).toBe("claude");
  });
});
