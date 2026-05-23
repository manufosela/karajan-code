/**
 * Regression tests for `resolveHome()` — the unified home-directory
 * resolver introduced in PR 1 of the `~/.kj/` → `~/.karajan/`
 * consolidation. Every helper in the codebase that used to roll its
 * own `getKjHome()` now delegates here, so this is the single contract
 * we have to defend.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  resolveHome,
  getKarajanHome,
  __resetKjHomeWarningForTests,
} from "../../src/utils/paths.js";

const SAVED_ENV_KEYS = ["KARAJAN_HOME", "KJ_HOME", "VITEST"];

function saveAndUnsetEnv() {
  const saved = {};
  for (const k of SAVED_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  return saved;
}

function restoreEnv(saved) {
  for (const k of SAVED_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe("resolveHome() precedence", () => {
  let saved;
  let warnSpy;

  beforeEach(() => {
    saved = saveAndUnsetEnv();
    __resetKjHomeWarningForTests();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    restoreEnv(saved);
    warnSpy.mockRestore();
  });

  it("KARAJAN_HOME wins over everything", () => {
    process.env.KARAJAN_HOME = "/tmp/karajan-explicit";
    process.env.KJ_HOME = "/tmp/kj-explicit";
    expect(resolveHome()).toBe("/tmp/karajan-explicit");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("KJ_HOME wins when KARAJAN_HOME is unset, and prints deprecation warning", () => {
    process.env.KJ_HOME = "/tmp/kj-explicit";
    expect(resolveHome()).toBe("/tmp/kj-explicit");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("KJ_HOME is deprecated");
  });

  it("deprecation warning is emitted at most ONCE per process", () => {
    process.env.KJ_HOME = "/tmp/kj-explicit";
    resolveHome();
    resolveHome();
    resolveHome();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("KARAJAN_HOME alongside KJ_HOME suppresses the deprecation warning", () => {
    process.env.KARAJAN_HOME = "/tmp/karajan-explicit";
    process.env.KJ_HOME = "/tmp/kj-explicit";
    resolveHome();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("VITEST without env vars returns a per-process tmp path under the chosen segment", () => {
    process.env.VITEST = "true";
    const karajan = resolveHome({ defaultSegment: ".karajan" });
    const kj = resolveHome({ defaultSegment: ".kj" });
    expect(karajan).toMatch(/karajan-vitest-\d+-[a-z0-9]+\/\.karajan$/);
    expect(kj).toMatch(/karajan-vitest-\d+-[a-z0-9]+\/\.kj$/);
    // Both share the same vitest root prefix
    expect(path.dirname(karajan)).toBe(path.dirname(kj));
  });

  it("no env vars and no VITEST returns ~/<defaultSegment>", () => {
    const karajan = resolveHome({ defaultSegment: ".karajan" });
    const kj = resolveHome({ defaultSegment: ".kj" });
    expect(karajan).toBe(path.join(os.homedir(), ".karajan"));
    expect(kj).toBe(path.join(os.homedir(), ".kj"));
  });

  it("getKarajanHome() exposes the canonical default", () => {
    // PR 3 of KJC-PCS-0047 removed getKjHomeLegacy — every caller is
    // now on the unified `.karajan` root.
    expect(getKarajanHome()).toBe(path.join(os.homedir(), ".karajan"));
  });

  it("KARAJAN_HOME values are resolved to absolute paths", () => {
    process.env.KARAJAN_HOME = "./relative-karajan";
    const home = resolveHome();
    expect(path.isAbsolute(home)).toBe(true);
    expect(home).toContain("relative-karajan");
  });
});
