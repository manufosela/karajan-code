import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFallbackChain, isAgentFailure, runRoleWithFallback } from "../src/orchestrator/post-loop-stages.js";

// Prevent actual imports from roles
vi.mock("../src/roles/tester-role.js", () => ({ TesterRole: class {} }));
vi.mock("../src/roles/security-role.js", () => ({ SecurityRole: class {} }));
vi.mock("../src/session-store.js", () => ({
  addCheckpoint: vi.fn(async () => {}),
  saveSession: vi.fn(async () => {})
}));
vi.mock("../src/utils/events.js", () => ({
  emitProgress: vi.fn(),
  makeEvent: vi.fn((type, base, payload) => ({ type, ...base, ...payload }))
}));
vi.mock("../src/orchestrator/solomon-escalation.js", () => ({
  invokeSolomon: vi.fn()
}));

describe("buildFallbackChain", () => {
  it("puts configured provider first, then remaining known agents", () => {
    const config = { roles: { tester: { provider: "codex" } }, coder: "claude" };
    expect(buildFallbackChain(config, "tester")).toEqual(["codex", "claude", "gemini"]);
  });

  it("falls back to coder provider when role has no provider", () => {
    const config = { roles: { tester: { provider: null }, coder: { provider: "gemini" } } };
    expect(buildFallbackChain(config, "tester")).toEqual(["gemini", "claude", "codex"]);
  });

  it("defaults to claude when nothing is configured", () => {
    const config = { roles: {} };
    expect(buildFallbackChain(config, "tester")).toEqual(["claude", "codex", "gemini"]);
  });

  it("does not duplicate the primary provider", () => {
    const config = { roles: { security: { provider: "claude" } } };
    const chain = buildFallbackChain(config, "security");
    const unique = [...new Set(chain)];
    expect(chain).toEqual(unique);
    expect(chain).toEqual(["claude", "codex", "gemini"]);
  });
});

describe("isAgentFailure", () => {
  it("returns true for agent error without verdict", () => {
    expect(isAgentFailure({ ok: false, result: { error: "unknown error" } })).toBe(true);
  });

  it("returns false when output is ok", () => {
    expect(isAgentFailure({ ok: true, result: { error: "ignored" } })).toBe(false);
  });

  it("returns false for genuine evaluation failure with verdict", () => {
    expect(isAgentFailure({ ok: false, result: { verdict: "fail", error: null } })).toBe(false);
  });

  it("returns false for null/undefined output", () => {
    expect(isAgentFailure(null)).toBe(false);
    expect(isAgentFailure(undefined)).toBe(false);
  });
});

describe("runRoleWithFallback", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
  const emitter = { emit: vi.fn() };
  const eventBase = { sessionId: "s1", iteration: 1, stage: null, startedAt: Date.now() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeMockRoleClass(behaviorByProvider) {
    return class MockRole {
      constructor({ config }) {
        this._provider = config?.roles?.tester?.provider || config?.roles?.security?.provider || "claude";
      }
      async init() {}
      async run(input) {
        const fn = behaviorByProvider[this._provider];
        if (!fn) throw new Error(`No mock for provider ${this._provider}`);
        return fn(input);
      }
    };
  }

  it("returns on first success without trying fallbacks", async () => {
    const MockRole = makeMockRoleClass({
      claude: () => ({ ok: true, result: { verdict: "pass" }, summary: "passed" })
    });

    const { output, provider, attempts } = await runRoleWithFallback(
      MockRole,
      { roleName: "tester", config: { roles: {} }, logger, emitter, eventBase, task: "t", iteration: 1, diff: "d" }
    );

    expect(output.ok).toBe(true);
    expect(provider).toBe("claude");
    expect(attempts).toHaveLength(1);
  });

  it("tries next agent when primary fails with agent error", async () => {
    const MockRole = makeMockRoleClass({
      claude: () => ({ ok: false, result: { error: "spawn failed" }, summary: "Tester failed: spawn failed" }),
      codex: () => ({ ok: true, result: { verdict: "pass" }, summary: "passed" })
    });

    const { output, provider, attempts } = await runRoleWithFallback(
      MockRole,
      { roleName: "tester", config: { roles: {} }, logger, emitter, eventBase, task: "t", iteration: 1, diff: "d" }
    );

    expect(output.ok).toBe(true);
    expect(provider).toBe("codex");
    expect(attempts).toHaveLength(2);
    expect(attempts[0].provider).toBe("claude");
    expect(attempts[0].ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("claude"));
  });

  it("does NOT fallback on genuine evaluation failure", async () => {
    const MockRole = makeMockRoleClass({
      claude: () => ({
        ok: false,
        result: { verdict: "fail", tests_pass: false, missing_scenarios: ["edge case"] },
        summary: "Verdict: fail"
      }),
      codex: () => ({ ok: true, result: { verdict: "pass" }, summary: "passed" })
    });

    const { output, provider, attempts } = await runRoleWithFallback(
      MockRole,
      { roleName: "tester", config: { roles: {} }, logger, emitter, eventBase, task: "t", iteration: 1, diff: "d" }
    );

    // Should NOT have tried codex
    expect(output.ok).toBe(false);
    expect(provider).toBe("claude");
    expect(attempts).toHaveLength(1);
  });

  it("tries all agents and returns clear error when all fail", async () => {
    const MockRole = makeMockRoleClass({
      claude: () => ({ ok: false, result: { error: "spawn" }, summary: "failed: spawn" }),
      codex: () => ({ ok: false, result: { error: "auth" }, summary: "failed: auth" }),
      gemini: () => ({ ok: false, result: { error: "not found" }, summary: "failed: not found" })
    });

    const { output, attempts } = await runRoleWithFallback(
      MockRole,
      { roleName: "tester", config: { roles: {} }, logger, emitter, eventBase, task: "t", iteration: 1, diff: "d" }
    );

    expect(output.ok).toBe(false);
    expect(output.summary).toContain("All tester agents failed");
    expect(output.summary).toContain("claude, codex, gemini");
    expect(attempts).toHaveLength(3);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("all agents failed"));
  });

  it("handles agent throwing exceptions", async () => {
    const MockRole = makeMockRoleClass({
      claude: () => { throw new Error("ENOENT: claude not found"); },
      codex: () => ({ ok: true, result: { verdict: "pass" }, summary: "passed" })
    });

    const { output, provider, attempts } = await runRoleWithFallback(
      MockRole,
      { roleName: "tester", config: { roles: {} }, logger, emitter, eventBase, task: "t", iteration: 1, diff: "d" }
    );

    expect(output.ok).toBe(true);
    expect(provider).toBe("codex");
    expect(attempts).toHaveLength(2);
    expect(attempts[0].ok).toBe(false);
  });

  it("emits fallback events for each failed agent", async () => {
    const { emitProgress } = await import("../src/utils/events.js");

    const MockRole = makeMockRoleClass({
      claude: () => ({ ok: false, result: { error: "err" }, summary: "failed" }),
      codex: () => ({ ok: false, result: { error: "err" }, summary: "failed" }),
      gemini: () => ({ ok: true, result: { verdict: "pass" }, summary: "passed" })
    });

    await runRoleWithFallback(
      MockRole,
      { roleName: "security", config: { roles: {} }, logger, emitter, eventBase, task: "t", iteration: 1, diff: "d" }
    );

    const fallbackCalls = emitProgress.mock.calls.filter(
      ([, evt]) => evt?.type === "security:fallback"
    );
    expect(fallbackCalls).toHaveLength(2); // claude and codex failed
  });

  it("respects configured primary provider order", async () => {
    const tried = [];
    const MockRole = makeMockRoleClass({
      gemini: (input) => { tried.push("gemini"); return { ok: false, result: { error: "err" }, summary: "failed" }; },
      claude: (input) => { tried.push("claude"); return { ok: true, result: { verdict: "pass" }, summary: "ok" }; },
      codex: (input) => { tried.push("codex"); return { ok: true, result: { verdict: "pass" }, summary: "ok" }; }
    });

    const config = { roles: { tester: { provider: "gemini" } } };
    await runRoleWithFallback(
      MockRole,
      { roleName: "tester", config, logger, emitter, eventBase, task: "t", iteration: 1, diff: "d" }
    );

    expect(tried).toEqual(["gemini", "claude"]); // gemini first (configured), then claude (first fallback)
  });
});
