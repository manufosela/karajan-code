// HU-2598: a shell that exports KARAJAN_HOME or KJ_HOME must not point the
// suite at the developer's real ~/.karajan.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("tests/setup.js home isolation", () => {
  let shellHome;
  let envBefore;

  beforeEach(() => {
    shellHome = mkdtempSync(join(tmpdir(), "kj-shell-home-"));
    envBefore = { ...process.env };
  });

  // Re-running setup.js rewrites env (GIT_CONFIG_COUNT, …): restore all of it.
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in envBefore)) delete process.env[key];
    }
    Object.assign(process.env, envBefore);
    rmSync(shellHome, { recursive: true, force: true });
  });

  it("drops KARAJAN_HOME and KJ_HOME exported before setup runs", async () => {
    process.env.KARAJAN_HOME = shellHome;
    process.env.KJ_HOME = shellHome;
    vi.resetModules();
    await import("./setup.js");
    const { getKarajanHome } = await import("../src/utils/paths.js");
    expect(process.env.KARAJAN_HOME).toBeUndefined();
    expect(process.env.KJ_HOME).toBeUndefined();
    expect(getKarajanHome()).not.toBe(shellHome);
    expect(getKarajanHome().startsWith(tmpdir())).toBe(true);
  });
});
