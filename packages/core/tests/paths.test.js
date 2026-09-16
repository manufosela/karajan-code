import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  resolveHome,
  getKarajanHome,
  withKarajanHome,
  getSessionRoot,
  getRunsDir,
  getPromptsDir,
  __resetKjHomeWarningForTests,
} from "../src/paths.js";

describe("karajan-core/paths", () => {
  let originalKarajanHome;
  let originalKjHome;

  beforeEach(() => {
    originalKarajanHome = process.env.KARAJAN_HOME;
    originalKjHome = process.env.KJ_HOME;
    delete process.env.KARAJAN_HOME;
    delete process.env.KJ_HOME;
    __resetKjHomeWarningForTests();
  });

  afterEach(() => {
    if (originalKarajanHome !== undefined) process.env.KARAJAN_HOME = originalKarajanHome;
    if (originalKjHome !== undefined) process.env.KJ_HOME = originalKjHome;
  });

  it("KARAJAN_HOME takes precedence", () => {
    process.env.KARAJAN_HOME = "/tmp/explicit-home";
    expect(resolveHome()).toBe(path.resolve("/tmp/explicit-home"));
  });

  it("getKarajanHome defaults to .karajan segment", () => {
    process.env.KARAJAN_HOME = "/tmp/root";
    expect(getKarajanHome()).toBe(path.resolve("/tmp/root"));
  });

  // KJC-BUG-0176 (#1722): MCP `kjHome` pins the home per async context.
  describe("withKarajanHome", () => {
    const readAfter = (home, delayMs) => withKarajanHome(home, async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return getKarajanHome();
    });

    it("pins the home for the async context and beats the env, without touching it", async () => {
      process.env.KARAJAN_HOME = "/tmp/env-home";
      expect(await readAfter("/tmp/pinned", 1)).toBe(path.resolve("/tmp/pinned"));
      expect(getKarajanHome()).toBe(path.resolve("/tmp/env-home"));
      expect(process.env.KARAJAN_HOME).toBe("/tmp/env-home");
    });

    it("keeps overlapping contexts apart", async () => {
      const [a, b] = await Promise.all([readAfter("/tmp/home-a", 5), readAfter("/tmp/home-b", 1)]);
      expect(a).toBe(path.resolve("/tmp/home-a"));
      expect(b).toBe(path.resolve("/tmp/home-b"));
    });
  });

  it("derived dirs hang off getKarajanHome", () => {
    process.env.KARAJAN_HOME = "/tmp/root";
    const home = path.resolve("/tmp/root");
    expect(getSessionRoot()).toBe(path.join(home, "sessions"));
    expect(getRunsDir()).toBe(path.join(home, "runs"));
    expect(getPromptsDir()).toBe(path.join(home, "prompts"));
  });

  it("VITEST env auto-isolates to tmpdir", () => {
    expect(resolveHome().startsWith(os.tmpdir())).toBe(true);
  });
});
