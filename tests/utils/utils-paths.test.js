import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";

describe("utils/paths", () => {
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

  describe("getKarajanHome", () => {
    it("returns ~/.karajan when KJ_HOME and VITEST are both unset", async () => {
      delete process.env.KJ_HOME;
      delete process.env.VITEST;
      const { getKarajanHome } = await import("../../src/utils/paths.js");
      expect(getKarajanHome()).toBe(path.join(os.homedir(), ".karajan"));
    });

    it("returns $KJ_HOME when set", async () => {
      process.env.KJ_HOME = "/custom/kj";
      const { getKarajanHome } = await import("../../src/utils/paths.js");
      expect(getKarajanHome()).toBe(path.resolve("/custom/kj"));
    });

    it("resolves relative $KJ_HOME to absolute", async () => {
      process.env.KJ_HOME = "relative/path";
      const { getKarajanHome } = await import("../../src/utils/paths.js");
      expect(path.isAbsolute(getKarajanHome())).toBe(true);
    });

    // Auto-isolation guard: a test that forgets to set KJ_HOME used
    // to drop files into the developer's real `~/.karajan/` and
    // pollute the running HU Board (49 phantom plans observed).
    // Under VITEST without KJ_HOME, the helper now returns a
    // per-process tmp dir so accidental writes can't leak.
    it("returns a tmp dir under VITEST when KJ_HOME is unset", async () => {
      delete process.env.KJ_HOME;
      process.env.VITEST = "true";
      const { getKarajanHome } = await import("../../src/utils/paths.js");
      const home = getKarajanHome();
      expect(home.startsWith(os.tmpdir())).toBe(true);
      expect(home).not.toBe(path.join(os.homedir(), ".karajan"));
      // Trailing `.karajan` segment preserves semantic parity with
      // non-VITEST defaults so existing path assertions still match.
      expect(home).toMatch(/karajan-vitest-\d+-[a-z0-9]+\/\.karajan$/);
    });

    it("memoises the tmp dir across calls within the same process", async () => {
      delete process.env.KJ_HOME;
      process.env.VITEST = "true";
      const { getKarajanHome } = await import("../../src/utils/paths.js");
      expect(getKarajanHome()).toBe(getKarajanHome());
    });

    it("explicit KJ_HOME wins over VITEST tmp default", async () => {
      process.env.KJ_HOME = "/explicit/path";
      process.env.VITEST = "true";
      const { getKarajanHome } = await import("../../src/utils/paths.js");
      expect(getKarajanHome()).toBe(path.resolve("/explicit/path"));
    });
  });

  describe("getSessionRoot", () => {
    it("returns sessions dir under karajan home", async () => {
      delete process.env.KJ_HOME;
      delete process.env.VITEST;
      const { getSessionRoot } = await import("../../src/utils/paths.js");
      expect(getSessionRoot()).toBe(path.join(os.homedir(), ".karajan", "sessions"));
    });
  });

  describe("getSonarComposePath", () => {
    it("returns docker-compose path under karajan home", async () => {
      delete process.env.KJ_HOME;
      delete process.env.VITEST;
      const { getSonarComposePath } = await import("../../src/utils/paths.js");
      expect(getSonarComposePath()).toBe(path.join(os.homedir(), ".karajan", "docker-compose.sonar.yml"));
    });
  });
});
