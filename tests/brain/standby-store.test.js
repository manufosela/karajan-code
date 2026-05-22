import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  persistStandby, loadStandby, listPendingStandby,
  markStandbyDone, acquireStandbyLock, standbyDir, standbyDoneDir,
  buildStandbyState,
} from "../../src/brain/standby-store.js";

// KJC-TSK-0414 PR 1: persistencia de sesiones hibernadas al disco.

let kjHome;
const SAVED_KJ_HOME = process.env.KJ_HOME;

beforeEach(() => {
  kjHome = mkdtempSync(path.join(tmpdir(), "kj-standby-"));
  process.env.KJ_HOME = kjHome;
});

afterEach(() => {
  if (SAVED_KJ_HOME === undefined) delete process.env.KJ_HOME;
  else process.env.KJ_HOME = SAVED_KJ_HOME;
  rmSync(kjHome, { recursive: true, force: true });
});

describe("persistStandby", () => {
  it("escribe JSON con createdAt y persistedAt", () => {
    const file = persistStandby({
      sessionId: "s1", role: "coder", prompt: "x",
      cooldownUntil: "2026-05-18T09:00:00Z",
      reason: "QUOTA_EXHAUSTED_DAILY",
    });
    expect(existsSync(file)).toBe(true);
    expect(file).toContain(path.join(kjHome, "standby", "s1.json"));
    const data = JSON.parse(readFileSync(file, "utf-8"));
    expect(data.sessionId).toBe("s1");
    expect(data.persistedAt).toBeTruthy();
    expect(data.createdAt).toBeTruthy();
  });

  it("rechaza sessionId vacío o sin cooldownUntil", () => {
    expect(() => persistStandby({})).toThrow(/sessionId/);
    expect(() => persistStandby({ sessionId: "x" })).toThrow(/cooldownUntil/);
  });

  it("sanitiza sessionId con caracteres especiales", () => {
    const file = persistStandby({
      sessionId: "weird/path:with*chars",
      cooldownUntil: "2026-05-18T09:00:00Z",
    });
    expect(file).toMatch(/weird_path_with_chars\.json$/);
  });
});

describe("loadStandby", () => {
  it("devuelve null si no existe", () => {
    expect(loadStandby("ghost")).toBeNull();
  });
  it("devuelve el JSON parseado", () => {
    persistStandby({ sessionId: "s2", cooldownUntil: "2026-05-18T09:00:00Z", planId: "p1" });
    const data = loadStandby("s2");
    expect(data.planId).toBe("p1");
  });
});

describe("listPendingStandby", () => {
  it("lista vacía cuando no existe el directorio", () => {
    expect(listPendingStandby()).toEqual([]);
  });
  it("lista solo los JSON top-level, ignora done/", () => {
    persistStandby({ sessionId: "s1", cooldownUntil: "2026-05-18T09:00:00Z" });
    persistStandby({ sessionId: "s2", cooldownUntil: "2026-05-18T09:00:00Z" });
    markStandbyDone("s1");
    const pending = listPendingStandby();
    expect(pending).toHaveLength(1);
    expect(pending[0].sessionId).toBe("s2");
  });
});

describe("markStandbyDone", () => {
  it("mueve el archivo a done/ con timestamp", () => {
    persistStandby({ sessionId: "s3", cooldownUntil: "2026-05-18T09:00:00Z" });
    expect(markStandbyDone("s3")).toBe(true);
    expect(existsSync(path.join(standbyDir(), "s3.json"))).toBe(false);
    expect(existsSync(standbyDoneDir())).toBe(true);
  });
  it("devuelve false si la sesión no existe", () => {
    expect(markStandbyDone("ghost")).toBe(false);
  });
});

describe("acquireStandbyLock", () => {
  it("primer acquire devuelve { acquired: true, release }", () => {
    const r = acquireStandbyLock("s4");
    expect(r.acquired).toBe(true);
    expect(typeof r.release).toBe("function");
    r.release();
  });
  it("segundo acquire concurrente devuelve { acquired: false }", () => {
    const a = acquireStandbyLock("s5");
    const b = acquireStandbyLock("s5");
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(false);
    a.release();
  });
  it("tras release, otro acquire vuelve a ok", () => {
    const a = acquireStandbyLock("s6");
    a.release();
    const b = acquireStandbyLock("s6");
    expect(b.acquired).toBe(true);
    b.release();
  });
});

describe("buildStandbyState", () => {
  it("devuelve null cuando no hay session.id", () => {
    expect(buildStandbyState({ session: {} })).toBeNull();
    expect(buildStandbyState({})).toBeNull();
  });

  it("incluye sessionId, planId, huId, cwd y argv", () => {
    const state = buildStandbyState({
      session: { id: "s_x", plan_id: "plan-7" },
      config: { projectDir: "/tmp/proj" },
      huId: "hu_3",
    });
    expect(state.sessionId).toBe("s_x");
    expect(state.planId).toBe("plan-7");
    expect(state.huId).toBe("hu_3");
    expect(state.cwd).toBe("/tmp/proj");
    expect(Array.isArray(state.argv)).toBe(true);
  });

  it("solo copia env allowlisted + KJ_* — nunca secretos arbitrarios", () => {
    process.env.KJ_CUSTOM_FLAG = "kj-value";
    process.env.SECRET_API_KEY = "do-not-leak";
    try {
      const state = buildStandbyState({ session: { id: "s_x" } });
      expect(state.env.KJ_CUSTOM_FLAG).toBe("kj-value");
      expect(state.env).not.toHaveProperty("SECRET_API_KEY");
    } finally {
      delete process.env.KJ_CUSTOM_FLAG;
      delete process.env.SECRET_API_KEY;
    }
  });
});
