import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/session/store.js", () => ({
  addCheckpoint: vi.fn(async () => {}),
  pauseSession: vi.fn(async () => {})
}));

describe("runCoderWithFallback", () => {
  let runCoderWithFallback, addCheckpoint;
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
  const emitter = { emit: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ runCoderWithFallback } = await import("../src/orchestrator/agent-fallback.js"));
    ({ addCheckpoint } = await import("../src/session/store.js"));
  });

  it("returns success on first attempt when primary agent succeeds", async () => {
    const executeMock = vi.fn().mockResolvedValue({
      ok: true,
      result: { output: "done", error: "", exitCode: 0, provider: "claude" },
      summary: "Coder completed"
    });

    const RoleClass = class {
      constructor() { this.execute = executeMock; }
      async init() {}
    };

    const result = await runCoderWithFallback({
      coderName: "claude",
      fallbackCoder: "codex",
      config: { roles: { coder: { provider: "claude" } }, session: { max_iteration_minutes: 5 } },
      logger, emitter,
      RoleClass,
      roleInput: { task: "test" },
      session: { id: "s1", checkpoints: [] },
      iteration: 1
    });

    expect(result.execResult.ok).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].coder).toBe("claude");
  });

  it("falls back to secondary agent when primary hits rate limit", async () => {
    const primaryExec = vi.fn().mockResolvedValue({
      ok: false,
      result: { output: "", error: "You've exceeded your usage limit. Please wait.", exitCode: 1 },
      summary: "rate limit"
    });
    const fallbackExec = vi.fn().mockResolvedValue({
      ok: true,
      result: { output: "done by fallback", error: "", exitCode: 0, provider: "codex" },
      summary: "Coder completed"
    });

    let callCount = 0;
    const RoleClass = class {
      constructor() {
        callCount++;
        this.execute = callCount === 1 ? primaryExec : fallbackExec;
      }
      async init() {}
    };

    const result = await runCoderWithFallback({
      coderName: "claude",
      fallbackCoder: "codex",
      config: { roles: { coder: { provider: "claude" } }, session: { max_iteration_minutes: 5 } },
      logger, emitter,
      RoleClass,
      roleInput: { task: "test" },
      session: { id: "s1", checkpoints: [] },
      iteration: 1
    });

    expect(result.execResult.ok).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].coder).toBe("claude");
    expect(result.attempts[0].ok).toBe(false);
    expect(result.attempts[0].rateLimited).toBe(true);
    expect(result.attempts[1].coder).toBe("codex");
    expect(result.attempts[1].ok).toBe(true);
  });

  it("returns null execResult when all agents fail with rate limits", async () => {
    const failExec = vi.fn().mockResolvedValue({
      ok: false,
      result: { output: "", error: "Rate limit exceeded", exitCode: 1 },
      summary: "rate limit"
    });

    const RoleClass = class {
      constructor() { this.execute = failExec; }
      async init() {}
    };

    const result = await runCoderWithFallback({
      coderName: "claude",
      fallbackCoder: "codex",
      config: { roles: { coder: { provider: "claude" } }, session: { max_iteration_minutes: 5 } },
      logger, emitter,
      RoleClass,
      roleInput: { task: "test" },
      session: { id: "s1", checkpoints: [] },
      iteration: 1
    });

    expect(result.execResult).toBeNull();
    expect(result.attempts).toHaveLength(2);
    expect(result.allRateLimited).toBe(true);
  });

  it("does not fallback on non-rate-limit errors", async () => {
    const failExec = vi.fn().mockResolvedValue({
      ok: false,
      result: { output: "", error: "Syntax error in file.js", exitCode: 1 },
      summary: "syntax error"
    });

    const RoleClass = class {
      constructor() { this.execute = failExec; }
      async init() {}
    };

    const result = await runCoderWithFallback({
      coderName: "claude",
      fallbackCoder: "codex",
      config: { roles: { coder: { provider: "claude" } }, session: { max_iteration_minutes: 5 } },
      logger, emitter,
      RoleClass,
      roleInput: { task: "test" },
      session: { id: "s1", checkpoints: [] },
      iteration: 1
    });

    expect(result.execResult).toBeNull();
    expect(result.attempts).toHaveLength(1);
    expect(result.allRateLimited).toBe(false);
  });

  it("works without fallback configured (fallbackCoder is null)", async () => {
    const failExec = vi.fn().mockResolvedValue({
      ok: false,
      result: { output: "", error: "Rate limit exceeded", exitCode: 1 },
      summary: "rate limit"
    });

    const RoleClass = class {
      constructor() { this.execute = failExec; }
      async init() {}
    };

    const result = await runCoderWithFallback({
      coderName: "claude",
      fallbackCoder: null,
      config: { roles: { coder: { provider: "claude" } }, session: { max_iteration_minutes: 5 } },
      logger, emitter,
      RoleClass,
      roleInput: { task: "test" },
      session: { id: "s1", checkpoints: [] },
      iteration: 1
    });

    expect(result.execResult).toBeNull();
    expect(result.attempts).toHaveLength(1);
    expect(result.allRateLimited).toBe(true);
  });

  it("tracks checkpoints for each attempt", async () => {
    const failExec = vi.fn().mockResolvedValue({
      ok: false,
      result: { output: "", error: "Usage limit reached", exitCode: 1 },
      summary: "limit"
    });
    const successExec = vi.fn().mockResolvedValue({
      ok: true,
      result: { output: "ok", error: "", exitCode: 0 },
      summary: "done"
    });

    let callCount = 0;
    const RoleClass = class {
      constructor() {
        callCount++;
        this.execute = callCount === 1 ? failExec : successExec;
      }
      async init() {}
    };

    await runCoderWithFallback({
      coderName: "claude",
      fallbackCoder: "codex",
      config: { roles: { coder: { provider: "claude" } }, session: { max_iteration_minutes: 5 } },
      logger, emitter,
      RoleClass,
      roleInput: { task: "test" },
      session: { id: "s1", checkpoints: [] },
      iteration: 2
    });

    expect(addCheckpoint).toHaveBeenCalledTimes(2);
    expect(addCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stage: "coder-attempt", coder: "claude", iteration: 2, ok: false })
    );
    expect(addCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stage: "coder-attempt", coder: "codex", iteration: 2, ok: true })
    );
  });

  it("calls onAttemptResult callback for each attempt", async () => {
    const onAttemptResult = vi.fn();
    const executeMock = vi.fn().mockResolvedValue({
      ok: true,
      result: { output: "done", error: "", exitCode: 0 },
      summary: "done"
    });

    const RoleClass = class {
      constructor() { this.execute = executeMock; }
      async init() {}
    };

    await runCoderWithFallback({
      coderName: "claude",
      fallbackCoder: null,
      config: { roles: { coder: { provider: "claude" } }, session: { max_iteration_minutes: 5 } },
      logger, emitter,
      RoleClass,
      roleInput: { task: "test" },
      session: { id: "s1", checkpoints: [] },
      iteration: 1,
      onAttemptResult
    });

    expect(onAttemptResult).toHaveBeenCalledWith(expect.objectContaining({ coder: "claude" }));
  });
});
