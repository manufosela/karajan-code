import { describe, it, expect, vi } from "vitest";
import { withBrainRecovery, DEFAULT_RECOVERY_POLICY } from "../../src/brain/with-brain-recovery.js";

// KJC-TSK-0415: fallback chain entre providers cuando QUOTA_EXHAUSTED_*
// con retryAfter > maxWaitHours.

const noSleep = () => Promise.resolve();

function quotaMonthlyError() {
  // 30 días en el futuro
  const at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return { ok: false, error: `monthly usage limit, resets at ${at}`, exitCode: 1 };
}

function quotaDailyError() {
  const at = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
  return { ok: false, error: `daily usage limit, resets at ${at}`, exitCode: 1 };
}

describe("withBrainRecovery — QUOTA_EXHAUSTED_MONTHLY", () => {
  it("classifier devuelve MONTHLY cuando cooldown > 7 días", async () => {
    const agent = { runTask: vi.fn().mockResolvedValue(quotaMonthlyError()) };
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "coder", sleepFn: noSleep });
    expect(r.action).toBe("hibernate");
    expect(r.recovery.class).toBe("QUOTA_EXHAUSTED_MONTHLY");
  });
});

describe("withBrainRecovery — fallback switch", () => {
  it("MONTHLY con fallback configurado → switch a fallback en vez de hibernar", async () => {
    const primary = {
      provider: "claude",
      runTask: vi.fn().mockResolvedValue(quotaMonthlyError()),
    };
    const fallbackAgent = {
      provider: "codex",
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "ok from codex" }),
    };
    const emit = vi.fn();
    const r = await withBrainRecovery({
      agent: primary, taskArgs: {}, role: "coder",
      fallback: { agent: fallbackAgent, provider: "codex", maxWaitHours: 12 },
      emitter: { emit }, sleepFn: noSleep,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toBe("ok from codex");
    expect(primary.runTask).toHaveBeenCalledTimes(1);
    expect(fallbackAgent.runTask).toHaveBeenCalledTimes(1);
    // Evento brain:fallback-switched
    const switched = emit.mock.calls.find(([_e, p]) => p?.type === "brain:fallback-switched");
    expect(switched).toBeTruthy();
    expect(switched[1].detail.from).toBe("claude");
    expect(switched[1].detail.to).toBe("codex");
  });

  it("DAILY con retryAfter > maxWaitHours → también switch (DAILY también es fallbackEligible)", async () => {
    const primary = {
      provider: "claude",
      runTask: vi.fn().mockResolvedValue(quotaDailyError()),
    };
    const fallbackAgent = {
      provider: "codex",
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "ok" }),
    };
    // 5h cooldown, maxWaitHours=2 → debe switch
    const r = await withBrainRecovery({
      agent: primary, taskArgs: {}, role: "coder",
      fallback: { agent: fallbackAgent, provider: "codex", maxWaitHours: 2 },
      sleepFn: noSleep,
    });
    expect(r.ok).toBe(true);
  });

  it("DAILY con retryAfter < maxWaitHours → NO switch (cooldown corto = standby in-process)", async () => {
    // Primary fails once with a daily quota, then succeeds when the
    // standby-in-process wait wakes up and retries. The fallback agent
    // must NEVER be called because the wait is below `maxWaitHours`.
    const primary = {
      provider: "claude",
      runTask: vi.fn()
        .mockResolvedValueOnce(quotaDailyError())
        .mockResolvedValueOnce({ ok: true, output: "primary recovered" }),
    };
    const fallbackAgent = {
      provider: "codex",
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "should not be called" }),
    };
    const r = await withBrainRecovery({
      agent: primary, taskArgs: {}, role: "coder",
      fallback: { agent: fallbackAgent, provider: "codex", maxWaitHours: 12 },
      sleepFn: noSleep,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toBe("primary recovered");
    expect(fallbackAgent.runTask).not.toHaveBeenCalled();
  });

  it("sin fallback configurado → hiberna (compat con TSK-0414)", async () => {
    const agent = { runTask: vi.fn().mockResolvedValue(quotaMonthlyError()) };
    const r = await withBrainRecovery({ agent, taskArgs: {}, role: "coder", sleepFn: noSleep });
    expect(r.action).toBe("hibernate");
  });

  it("cadena: fallback agotado también → switch al fallback-del-fallback", async () => {
    const primary = { provider: "claude", runTask: vi.fn().mockResolvedValue(quotaMonthlyError()) };
    const fallback1 = { provider: "codex", runTask: vi.fn().mockResolvedValue(quotaMonthlyError()) };
    const fallback2 = { provider: "opencode", runTask: vi.fn().mockResolvedValue({ ok: true, output: "from opencode" }) };
    const r = await withBrainRecovery({
      agent: primary, taskArgs: {}, role: "coder",
      fallback: {
        agent: fallback1, provider: "codex", maxWaitHours: 12,
        fallback: { agent: fallback2, provider: "opencode", maxWaitHours: 12 },
      },
      sleepFn: noSleep,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toBe("from opencode");
    expect(primary.runTask).toHaveBeenCalledTimes(1);
    expect(fallback1.runTask).toHaveBeenCalledTimes(1);
    expect(fallback2.runTask).toHaveBeenCalledTimes(1);
  });

  it("último fallback de la cadena también falla → hiberna con el último error", async () => {
    const primary = { provider: "claude", runTask: vi.fn().mockResolvedValue(quotaMonthlyError()) };
    const fallback1 = { provider: "codex", runTask: vi.fn().mockResolvedValue(quotaMonthlyError()) };
    const r = await withBrainRecovery({
      agent: primary, taskArgs: {}, role: "coder",
      fallback: { agent: fallback1, provider: "codex", maxWaitHours: 12 },
      sleepFn: noSleep,
    });
    expect(r.action).toBe("hibernate");
    expect(r.recovery.class).toBe("QUOTA_EXHAUSTED_MONTHLY");
  });

  it("maxWaitHours del policy default (12h) si fallback no lo especifica", async () => {
    expect(DEFAULT_RECOVERY_POLICY.fallbackWaitHoursDefault).toBe(12);
  });
});

// KJC-TSK-0859: un modelo retirado por el proveedor no tiene cooldown que
// esperar, así que no pasa por la condición de cuota: si hay eslabón
// siguiente se toma, y si no lo hay se aborta en vez de reintentar un modelo
// muerto hasta agotar la cuota.
const deadModelError = () => ({ ok: false, error: "model gpt-5.4-mini is not supported when using a ChatGPT account", exitCode: 1 });

describe("withBrainRecovery — MODEL_UNAVAILABLE", () => {
  it("toma el siguiente eslabón inmediatamente, sin esperar cuota alguna", async () => {
    const primary = { provider: "codex", model: "gpt-5.4-mini", runTask: vi.fn().mockResolvedValue(deadModelError()) };
    const next = { provider: "codex", model: "gpt-5.6-terra", runTask: vi.fn().mockResolvedValue({ ok: true, output: "ok" }) };
    const emit = vi.fn();
    const warn = vi.fn();
    const r = await withBrainRecovery({
      agent: primary, taskArgs: {}, role: "reviewer",
      fallback: { agent: next, provider: "codex", model: "gpt-5.6-terra" },
      emitter: { emit }, logger: { warn }, sleepFn: noSleep,
    });
    expect(r.ok).toBe(true);
    expect(next.runTask).toHaveBeenCalledTimes(1);
    const switched = emit.mock.calls.find(([_e, p]) => p?.type === "brain:fallback-switched");
    expect(switched[1].detail.immediate).toBe(true);
    // El aviso dice qué murió, qué lo sustituye y cómo fijarlo.
    const said = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(said).toContain("gpt-5.4-mini");
    expect(said).toContain("gpt-5.6-terra");
    expect(said).toContain("roles.reviewer");
  });

  it("sin cadena declarada aborta: reintentar un modelo muerto no lo resucita", async () => {
    const primary = { provider: "codex", runTask: vi.fn().mockResolvedValue(deadModelError()) };
    const r = await withBrainRecovery({ agent: primary, taskArgs: {}, role: "coder", sleepFn: noSleep });
    expect(r.ok).toBe(false);
    expect(r.action).toBe("abort");
    expect(r.recovery.class).toBe("MODEL_UNAVAILABLE");
    expect(primary.runTask).toHaveBeenCalledTimes(1);
  });

  it("recorre la cadena entera: cada eslabón muerto pasa al siguiente", async () => {
    const dead = (p, m) => ({ provider: p, model: m, runTask: vi.fn().mockResolvedValue(deadModelError()) });
    const first = dead("codex", "gpt-5.4");
    const second = dead("codex", "gpt-5.4-mini");
    const third = { provider: "claude", model: "opus", runTask: vi.fn().mockResolvedValue({ ok: true, output: "ok" }) };
    const r = await withBrainRecovery({
      agent: first, taskArgs: {}, role: "coder",
      fallback: { agent: second, provider: "codex", model: "gpt-5.4-mini", fallback: { agent: third, provider: "claude", model: "opus" } },
      sleepFn: noSleep,
    });
    expect(r.ok).toBe(true);
    expect(second.runTask).toHaveBeenCalledTimes(1);
    expect(third.runTask).toHaveBeenCalledTimes(1);
  });
});
