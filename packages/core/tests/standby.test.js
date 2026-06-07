import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  persistStandby, loadStandby, listPendingStandby, markStandbyDone,
  acquireStandbyLock, standbyDir,
} from "../src/standby-store.js";
import {
  scheduleResume, cancelScheduled, _resetScheduledForTests,
} from "../src/standby-scheduler.js";

let tmp;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kj-core-standby-"));
  process.env.KJ_HOME = tmp;
  _resetScheduledForTests();
});
afterEach(() => {
  delete process.env.KJ_HOME;
  rmSync(tmp, { recursive: true, force: true });
});

describe("@karajan/core/standby-store", () => {
  it("persists + loads + lists pending sessions", () => {
    persistStandby({ sessionId: "s_1", cooldownUntil: "2099-01-01T00:00:00Z", reason: "QUOTA" });
    const loaded = loadStandby("s_1");
    expect(loaded.sessionId).toBe("s_1");
    expect(listPendingStandby()).toHaveLength(1);
    expect(standbyDir().startsWith(tmp)).toBe(true);
  });

  it("markStandbyDone moves the file under done/", () => {
    persistStandby({ sessionId: "s_2", cooldownUntil: "2099-01-01T00:00:00Z" });
    expect(markStandbyDone("s_2")).toBe(true);
    expect(loadStandby("s_2")).toBe(null);
  });

  it("acquireStandbyLock is exclusive", () => {
    const a = acquireStandbyLock("s_3");
    expect(a.acquired).toBe(true);
    const b = acquireStandbyLock("s_3");
    expect(b.acquired).toBe(false);
    a.release();
    const c = acquireStandbyLock("s_3");
    expect(c.acquired).toBe(true);
    c.release();
  });
});

describe("@karajan/core/standby-scheduler", () => {
  it("scheduleResume with expired cooldown fires immediate", async () => {
    const cb = vi.fn();
    const r = scheduleResume({ sessionId: "s_4", cooldownUntil: "1990-01-01T00:00:00Z", onResume: cb });
    expect(r.scheduled).toBe(true);
    expect(r.immediate).toBe(true);
    await new Promise((res) => setImmediate(res));
    expect(cb).toHaveBeenCalledWith("s_4");
  });

  it("cancelScheduled removes a queued timeout", () => {
    scheduleResume({ sessionId: "s_5", cooldownUntil: "2099-01-01T00:00:00Z", onResume: () => {} });
    expect(cancelScheduled("s_5")).toBe(true);
    expect(cancelScheduled("s_5")).toBe(false);
  });
});
