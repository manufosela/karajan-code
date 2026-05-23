import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Regression test for the "phantom projects on the board" bug —
// see src/db.js::getKjHome. Without VITEST auto-isolation, a hu-board
// test that didn't set KJ_HOME would write into the developer's real
// `~/.karajan/hu-board.db` and leave rogue rows visible on the board.

describe("hu-board db.getKjHome — VITEST auto-isolation", () => {
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

  it("returns ~/.karajan when KJ_HOME and VITEST are both unset", async () => {
    delete process.env.KJ_HOME;
    delete process.env.VITEST;
    const { getKjHome } = await import("../src/db.js");
    expect(getKjHome()).toBe(join(process.env.HOME || "/root", ".karajan"));
  });

  it("returns $KJ_HOME when explicitly set", async () => {
    process.env.KJ_HOME = "/explicit/karajan";
    const { getKjHome } = await import("../src/db.js");
    expect(getKjHome()).toBe("/explicit/karajan");
  });

  it("returns a tmp dir under VITEST when KJ_HOME is unset", async () => {
    delete process.env.KJ_HOME;
    process.env.VITEST = "true";
    const { getKjHome } = await import("../src/db.js");
    const home = getKjHome();
    expect(home.startsWith(tmpdir())).toBe(true);
    // Trailing `.karajan` segment preserves semantic parity with
    // the non-VITEST default so existing path assertions still match.
    expect(home).toMatch(/karajan-vitest-\d+-[a-z0-9]+\/\.karajan$/);
  });

  it("memoises the tmp dir across calls within the same process", async () => {
    delete process.env.KJ_HOME;
    process.env.VITEST = "true";
    const { getKjHome } = await import("../src/db.js");
    expect(getKjHome()).toBe(getKjHome());
  });

  it("explicit KJ_HOME wins over VITEST tmp default", async () => {
    process.env.KJ_HOME = "/winner";
    process.env.VITEST = "true";
    const { getKjHome } = await import("../src/db.js");
    expect(getKjHome()).toBe("/winner");
  });

  it("KARAJAN_HOME has priority over KJ_HOME (KJC-TSK-0420)", async () => {
    process.env.KARAJAN_HOME = "/canonical";
    process.env.KJ_HOME = "/legacy";
    try {
      const { getKjHome } = await import("../src/db.js");
      expect(getKjHome()).toBe("/canonical");
    } finally {
      delete process.env.KARAJAN_HOME;
    }
  });
});
