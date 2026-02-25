import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";

describe("utils/paths", () => {
  const originalEnv = process.env.KJ_HOME;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.KJ_HOME = originalEnv;
    } else {
      delete process.env.KJ_HOME;
    }
    vi.resetModules();
  });

  describe("getKarajanHome", () => {
    it("returns ~/.karajan by default", async () => {
      delete process.env.KJ_HOME;
      const { getKarajanHome } = await import("../src/utils/paths.js");
      expect(getKarajanHome()).toBe(path.join(os.homedir(), ".karajan"));
    });

    it("returns $KJ_HOME when set", async () => {
      process.env.KJ_HOME = "/custom/kj";
      const { getKarajanHome } = await import("../src/utils/paths.js");
      expect(getKarajanHome()).toBe(path.resolve("/custom/kj"));
    });

    it("resolves relative $KJ_HOME to absolute", async () => {
      process.env.KJ_HOME = "relative/path";
      const { getKarajanHome } = await import("../src/utils/paths.js");
      expect(path.isAbsolute(getKarajanHome())).toBe(true);
    });
  });

  describe("getSessionRoot", () => {
    it("returns sessions dir under karajan home", async () => {
      delete process.env.KJ_HOME;
      const { getSessionRoot } = await import("../src/utils/paths.js");
      expect(getSessionRoot()).toBe(path.join(os.homedir(), ".karajan", "sessions"));
    });
  });

  describe("getSonarComposePath", () => {
    it("returns docker-compose path under karajan home", async () => {
      delete process.env.KJ_HOME;
      const { getSonarComposePath } = await import("../src/utils/paths.js");
      expect(getSonarComposePath()).toBe(path.join(os.homedir(), ".karajan", "docker-compose.sonar.yml"));
    });
  });
});
