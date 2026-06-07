import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  resolveHome,
  getKarajanHome,
  getSessionRoot,
  getRunsDir,
  getPromptsDir,
  __resetKjHomeWarningForTests,
} from "../src/paths.js";

describe("@karajan/core/paths", () => {
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
