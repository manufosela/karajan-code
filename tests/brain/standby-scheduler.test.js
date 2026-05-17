import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { scheduleResume, cancelScheduled, reconcileAll, _resetScheduledForTests } from "../../src/brain/standby-scheduler.js";
import { persistStandby } from "../../src/brain/standby-store.js";

// KJC-TSK-0414 PR 1: scheduler event-driven (setTimeout único per session).

let kjHome;
const SAVED_KJ_HOME = process.env.KJ_HOME;

beforeEach(() => {
  kjHome = mkdtempSync(path.join(tmpdir(), "kj-sched-"));
  process.env.KJ_HOME = kjHome;
  vi.useFakeTimers();
});

afterEach(() => {
  _resetScheduledForTests();
  vi.useRealTimers();
  if (SAVED_KJ_HOME === undefined) delete process.env.KJ_HOME;
  else process.env.KJ_HOME = SAVED_KJ_HOME;
  rmSync(kjHome, { recursive: true, force: true });
});

describe("scheduleResume", () => {
  it("programa setTimeout y dispara onResume en cooldownUntil", () => {
    const onResume = vi.fn();
    const cooldownUntil = new Date(Date.now() + 60_000).toISOString();
    const r = scheduleResume({ sessionId: "s1", cooldownUntil, onResume });
    expect(r.scheduled).toBe(true);
    expect(r.msUntil).toBeGreaterThan(0);
    expect(onResume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(onResume).toHaveBeenCalledWith("s1");
  });

  it("cooldownUntil ya pasado → onResume inmediato (async)", async () => {
    const onResume = vi.fn();
    const past = new Date(Date.now() - 1000).toISOString();
    const r = scheduleResume({ sessionId: "s2", cooldownUntil: past, onResume });
    expect(r.scheduled).toBe(true);
    expect(r.immediate).toBe(true);
    // Promise.resolve().then() — esperamos una microtask
    await Promise.resolve();
    expect(onResume).toHaveBeenCalledWith("s2");
  });

  it("re-scheduleResume cancela el previo (no doble fire)", () => {
    const onResume = vi.fn();
    const t1 = new Date(Date.now() + 60_000).toISOString();
    const t2 = new Date(Date.now() + 120_000).toISOString();
    scheduleResume({ sessionId: "s3", cooldownUntil: t1, onResume });
    scheduleResume({ sessionId: "s3", cooldownUntil: t2, onResume });
    vi.advanceTimersByTime(60_000);
    expect(onResume).not.toHaveBeenCalled(); // primer timeout cancelado
    vi.advanceTimersByTime(60_000);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("args inválidos → { scheduled: false }", () => {
    expect(scheduleResume({}).scheduled).toBe(false);
    expect(scheduleResume({ sessionId: "x" }).scheduled).toBe(false);
    expect(scheduleResume({ sessionId: "x", cooldownUntil: "not-a-date" }).scheduled).toBe(false);
  });
});

describe("cancelScheduled", () => {
  it("cancela el setTimeout pendiente", () => {
    const onResume = vi.fn();
    const future = new Date(Date.now() + 60_000).toISOString();
    scheduleResume({ sessionId: "s4", cooldownUntil: future, onResume });
    expect(cancelScheduled("s4")).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(onResume).not.toHaveBeenCalled();
  });
  it("devuelve false si no había nada programado", () => {
    expect(cancelScheduled("ghost")).toBe(false);
  });
});

describe("reconcileAll", () => {
  it("scan vacío → 0 sesiones", () => {
    const r = reconcileAll({ onResume: vi.fn() });
    expect(r).toEqual({ scheduled: 0, immediate: 0, total: 0 });
  });

  it("sesiones pendientes: expiradas → immediate; futuras → scheduled", async () => {
    const past = new Date(Date.now() - 5000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    persistStandby({ sessionId: "expired", cooldownUntil: past });
    persistStandby({ sessionId: "future", cooldownUntil: future });
    persistStandby({ sessionId: "future2", cooldownUntil: future });

    const onResume = vi.fn();
    const r = reconcileAll({ onResume });
    expect(r.total).toBe(3);
    expect(r.immediate).toBe(1);
    expect(r.scheduled).toBe(2);
    // Esperamos a que el immediate se resuelva en microtask
    await Promise.resolve();
    expect(onResume).toHaveBeenCalledWith("expired");
    // Las futuras todavía no
    expect(onResume).toHaveBeenCalledTimes(1);
    // Avanza el reloj — disparan las dos futuras
    vi.advanceTimersByTime(60_000);
    expect(onResume).toHaveBeenCalledTimes(3);
  });
});
