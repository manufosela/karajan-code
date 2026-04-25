import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";

// Regression test for the "phantom Karajan Code project on the board"
// bug: tests that called savePlan() without setting KJ_HOME used to
// drop fixture files into the developer's real `~/.kj/plans/`. The
// running HU Board's chokidar watcher then ingested them as real
// plans (49 phantom "Add auth" entries observed). The fix lives in
// src/plan/plan-store.js::getKjHome — under VITEST without KJ_HOME,
// it returns a per-process tmp dir.

describe("plan-store getKjHome — VITEST auto-isolation", () => {
  const originalKjHome = process.env.KJ_HOME;
  const originalVitest = process.env.VITEST;

  afterEach(() => {
    if (originalKjHome !== undefined) {
      process.env.KJ_HOME = originalKjHome;
    } else {
      delete process.env.KJ_HOME;
    }
    if (originalVitest !== undefined) {
      process.env.VITEST = originalVitest;
    } else {
      delete process.env.VITEST;
    }
    vi.resetModules();
  });

  it("returns ~/.kj when KJ_HOME and VITEST are both unset", async () => {
    delete process.env.KJ_HOME;
    delete process.env.VITEST;
    const { getKjHome } = await import("../src/plan/plan-store.js");
    expect(getKjHome()).toBe(path.join(os.homedir(), ".kj"));
  });

  it("returns $KJ_HOME when set", async () => {
    process.env.KJ_HOME = "/explicit/kj";
    const { getKjHome } = await import("../src/plan/plan-store.js");
    expect(getKjHome()).toBe("/explicit/kj");
  });

  it("returns a tmp dir under VITEST when KJ_HOME is unset", async () => {
    delete process.env.KJ_HOME;
    process.env.VITEST = "true";
    const { getKjHome } = await import("../src/plan/plan-store.js");
    const home = getKjHome();
    expect(home.startsWith(os.tmpdir())).toBe(true);
    expect(home).not.toBe(path.join(os.homedir(), ".kj"));
    // Trailing `.kj` segment preserves semantic parity with the
    // default `~/.kj` so existing path assertions still match.
    expect(home).toMatch(/kj-vitest-\d+-[a-z0-9]+\/\.kj$/);
  });

  it("memoises the tmp dir across calls within the same process", async () => {
    delete process.env.KJ_HOME;
    process.env.VITEST = "true";
    const { getKjHome } = await import("../src/plan/plan-store.js");
    expect(getKjHome()).toBe(getKjHome());
  });

  it("explicit KJ_HOME wins over VITEST tmp default", async () => {
    process.env.KJ_HOME = "/winner";
    process.env.VITEST = "true";
    const { getKjHome } = await import("../src/plan/plan-store.js");
    expect(getKjHome()).toBe("/winner");
  });

  it("plansDir + savePlan write under the tmp root, not ~/.kj/", async () => {
    delete process.env.KJ_HOME;
    process.env.VITEST = "true";
    const { plansDir, savePlan, getKjHome } = await import("../src/plan/plan-store.js");
    const projectDir = "/some/fake/project";
    const dir = plansDir(projectDir);
    expect(dir.startsWith(getKjHome())).toBe(true);
    expect(dir).not.toContain(path.join(os.homedir(), ".kj"));

    const planId = await savePlan(projectDir, {
      planId: "plan-isolation-test",
      version: 2,
      hus: [],
      task: "isolation",
    });
    expect(planId).toBe("plan-isolation-test");

    const fs = await import("node:fs/promises");
    const stats = await fs.stat(path.join(dir, "plan-isolation-test.json"));
    expect(stats.isFile()).toBe(true);
  });
});
