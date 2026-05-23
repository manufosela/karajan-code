import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { withBrainRecovery, DEFAULT_RECOVERY_POLICY } from "../../src/brain/with-brain-recovery.js";

// KJC-TSK-0412: Brain decide retry/standby/hibernate/abort según clase.
// sleepFn inyectable → tests no esperan tiempo real.

const noSleep = () => Promise.resolve();

function makeAgent(responses) {
  let i = 0;
  return {
    provider: "claude",
    runTask: vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return r;
    }),
  };
}

describe("withBrainRecovery — happy path", () => {
  it("ok inmediato → devuelve resultado, sin retries", async () => {
    const agent = makeAgent([{ ok: true, output: "done" }]);
    const r = await withBrainRecovery({ agent, taskArgs: { prompt: "x" }, role: "planner", sleepFn: noSleep });
    expect(r.ok).toBe(true);
    expect(agent.runTask).toHaveBeenCalledTimes(1);
  });
});

describe("withBrainRecovery — RATE_LIMIT_SHORT → standby + retry", () => {
  it("rate limit con retry-after, segundo intento ok", async () => {
    const agent = makeAgent([
      { ok: false, error: "rate limit, retry after 10 seconds", exitCode: 1 },
      { ok: true, output: "done" },
    ]);
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "coder", sleepFn: noSleep });
    expect(r.ok).toBe(true);
    expect(agent.runTask).toHaveBeenCalledTimes(2);
  });

  it("3 retries consecutivos → abort", async () => {
    const agent = makeAgent([
      { ok: false, error: "429 rate limit, retry after 10 seconds", exitCode: 1 },
    ]);
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "coder", sleepFn: noSleep });
    expect(r.ok).toBe(false);
    expect(r.action).toBe("abort");
    expect(r.recovery.class).toBe("RATE_LIMIT_SHORT");
    // 3 retries + intento fallido N+1 que dispara el abort = 4 llamadas
    expect(agent.runTask).toHaveBeenCalledTimes(4);
  });
});

describe("withBrainRecovery — QUOTA_EXHAUSTED_DAILY → hibernate", () => {
  it("quota con reset >12h → action='hibernate' inmediato (demasiado largo para esperar in-process)", async () => {
    const target = new Date(Date.now() + 15 * 60 * 60 * 1000).toISOString();
    const agent = makeAgent([
      { ok: false, error: `usage limit reached, resets at ${target}`, exitCode: 1 },
    ]);
    const emit = vi.fn();
    const emitter = { emit };
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "planner", emitter, sleepFn: noSleep });
    expect(r.ok).toBe(false);
    expect(r.action).toBe("hibernate");
    expect(r.recovery.class).toBe("QUOTA_EXHAUSTED_DAILY");
    expect(r.recovery.retryUntil).toBe(target);
    const hibernateEvent = emit.mock.calls.find(([_evt, payload]) => payload?.type === "brain:hibernate-request");
    expect(hibernateEvent).toBeTruthy();
  });

  it("con sessionState (>12h) persiste el standby a disco y devuelve standbyFile", async () => {
    const target = new Date(Date.now() + 15 * 60 * 60 * 1000).toISOString();
    const agent = makeAgent([
      { ok: false, error: `usage limit reached, resets at ${target}`, exitCode: 1 },
    ]);
    const sessionState = {
      sessionId: "s_test-hibernate", argv: ["run", "build a thing"], cwd: "/tmp/proj", env: {},
    };
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "coder", sessionState, sleepFn: noSleep });
    expect(r.action).toBe("hibernate");
    expect(r.standbyFile).toBeTruthy();
    const persisted = JSON.parse(readFileSync(r.standbyFile, "utf-8"));
    expect(persisted.sessionId).toBe("s_test-hibernate");
    expect(persisted.cooldownUntil).toBe(target);
    expect(persisted.argv).toEqual(["run", "build a thing"]);
  });

  it("sin sessionState NO persiste (standbyFile null) — regresión del bug original", async () => {
    const target = new Date(Date.now() + 15 * 60 * 60 * 1000).toISOString();
    const agent = makeAgent([
      { ok: false, error: `usage limit reached, resets at ${target}`, exitCode: 1 },
    ]);
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "coder", sleepFn: noSleep });
    expect(r.action).toBe("hibernate");
    expect(r.standbyFile ?? null).toBeNull();
  });

  // The user's request: short cooldowns (daily quota resets ~5h)
  // should NOT exit kj — kj stays alive, waits, retries on its own.
  // Only Ctrl+C during the wait should print the resume hint.
  it("quota con reset corto (<=12h) → standby in-process + retry cuando despierta", async () => {
    const target = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const agent = makeAgent([
      { ok: false, error: `usage limit reached, resets at ${target}`, exitCode: 1 },
      { ok: true, output: "second call succeeds after the wait" },
    ]);
    const emit = vi.fn();
    const emitter = { emit };
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "coder", emitter, sleepFn: noSleep });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("second call succeeds");
    expect(agent.runTask).toHaveBeenCalledTimes(2);
    // Emitted the standby-wait + standby-resumed events, NOT hibernate-request.
    const waitEvt = emit.mock.calls.find(([_e, p]) => p?.type === "brain:standby-wait");
    const resumedEvt = emit.mock.calls.find(([_e, p]) => p?.type === "brain:standby-resumed");
    const hibernateEvt = emit.mock.calls.find(([_e, p]) => p?.type === "brain:hibernate-request");
    expect(waitEvt).toBeTruthy();
    expect(resumedEvt).toBeTruthy();
    expect(hibernateEvt).toBeFalsy();
  });
});

describe("withBrainRecovery — backoff exponencial", () => {
  it("NETWORK_TIMEOUT recuperable: 1er fallo + 2do ok", async () => {
    const agent = makeAgent([
      { ok: false, error: "ECONNRESET", exitCode: 1 },
      { ok: true, output: "done" },
    ]);
    const sleeps = [];
    const sleepFn = vi.fn(async (ms) => { sleeps.push(ms); });
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "coder", sleepFn });
    expect(r.ok).toBe(true);
    expect(sleepFn).toHaveBeenCalledTimes(1);
    expect(sleeps[0]).toBeGreaterThan(0);
  });

  it("API_DOWN retries con delays crecientes (factor 3)", async () => {
    const agent = makeAgent([
      { ok: false, error: "503 service unavailable", exitCode: 1 },
      { ok: false, error: "503 service unavailable", exitCode: 1 },
      { ok: true, output: "done" },
    ]);
    const sleeps = [];
    const sleepFn = vi.fn(async (ms) => { sleeps.push(ms); });
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "coder", sleepFn });
    expect(r.ok).toBe(true);
    // Backoff es base * factor^attempt: 5s, 15s, 45s con jitter ±20%
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
  });
});

describe("withBrainRecovery — AUTH_FAILED → abort sin retry", () => {
  it("401 → action='abort' sin reintentar", async () => {
    const agent = makeAgent([{ ok: false, error: "401 unauthorized", exitCode: 1 }]);
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "coder", sleepFn: noSleep });
    expect(r.ok).toBe(false);
    expect(r.action).toBe("abort");
    expect(r.recovery.class).toBe("AUTH_FAILED");
    expect(agent.runTask).toHaveBeenCalledTimes(1);
  });
});

describe("withBrainRecovery — SILENCED → backoff", () => {
  it("silenced 1ra vez, 2da ok", async () => {
    const agent = makeAgent([
      { ok: false, error: "Command killed after 180000ms without output", exitCode: 143 },
      { ok: true, output: "done" },
    ]);
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "planner", sleepFn: noSleep });
    expect(r.ok).toBe(true);
    expect(agent.runTask).toHaveBeenCalledTimes(2);
  });
});

describe("withBrainRecovery — observabilidad", () => {
  it("emite brain:agent-error en cada fallo + brain:fatal en abort", async () => {
    const agent = makeAgent([{ ok: false, error: "401 unauthorized", exitCode: 1 }]);
    const emit = vi.fn();
    await withBrainRecovery({ agent, taskArgs: {}, role: "coder", emitter: { emit }, sleepFn: noSleep });
    const types = emit.mock.calls.map(([_evt, p]) => p?.type);
    expect(types).toContain("brain:agent-error");
    expect(types).toContain("brain:fatal");
  });

  it("emite brain:backoff con waitMs en recuperables backoff", async () => {
    const agent = makeAgent([
      { ok: false, error: "ECONNRESET", exitCode: 1 },
      { ok: true, output: "done" },
    ]);
    const emit = vi.fn();
    await withBrainRecovery({ agent, taskArgs: {}, role: "coder", emitter: { emit }, sleepFn: noSleep });
    const backoff = emit.mock.calls.find(([_evt, p]) => p?.type === "brain:backoff");
    expect(backoff).toBeTruthy();
    expect(backoff[1].detail.waitMs).toBeGreaterThan(0);
  });
});

describe("withBrainRecovery — políticas custom", () => {
  it("respeta maxRetries override del caller", async () => {
    const agent = makeAgent([
      { ok: false, error: "429 rate limit", exitCode: 1 },
    ]);
    const policy = {
      ...DEFAULT_RECOVERY_POLICY,
      classes: {
        ...DEFAULT_RECOVERY_POLICY.classes,
        RATE_LIMIT_SHORT: { mode: "standby", maxRetries: 1 },
      },
    };
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "coder", policy, sleepFn: noSleep });
    expect(r.action).toBe("abort");
    expect(agent.runTask).toHaveBeenCalledTimes(2); // 1 retry + abort
  });
});
