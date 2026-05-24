/**
 * KJC-TSK-0395 — `kj init` config scope (global vs local) + hierarchy
 * validation in loadConfig.
 *
 * Acceptance pins:
 *   A) `--global` → returns the global path, no wizard.
 *   B) `--local`  → returns the project-local path, no wizard.
 *   C) `--global --local` → throws (mutually exclusive).
 *   D) Non-interactive + no flags → global (legacy default).
 *   E) loadConfig throws when a local config exists without a global one
 *      (the override-only-on-top-of-base invariant).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveConfigScope } from "../../src/commands/init.js";
import { loadConfig, getConfigPath, getProjectConfigPath } from "../../src/config.js";

describe("kj init — resolveConfigScope — KJC-TSK-0395", () => {
  it("A) --global returns the global path with scope 'global'", async () => {
    const r = await resolveConfigScope({ flags: { global: true }, interactive: false });
    expect(r.scope).toBe("global");
    expect(r.configPath).toBe(getConfigPath());
  });

  it("B) --local returns the project-local path with scope 'local'", async () => {
    const r = await resolveConfigScope({ flags: { local: true }, interactive: false });
    expect(r.scope).toBe("local");
    expect(r.configPath).toBe(getProjectConfigPath(process.cwd()));
  });

  it("C) --global + --local together throws a clear error", async () => {
    await expect(resolveConfigScope({ flags: { global: true, local: true }, interactive: false }))
      .rejects.toThrow(/both --global and --local/);
  });

  it("D) non-interactive + no flags defaults to global (legacy)", async () => {
    const r = await resolveConfigScope({ flags: {}, interactive: false });
    expect(r.scope).toBe("global");
  });
});

describe("loadConfig — local-sin-global rejection — KJC-TSK-0395", () => {
  let projectDir;
  let prevHome;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kj-scope-"));
    // Redirect KARAJAN_HOME to an empty temp dir so getConfigPath()
    // points to a location with NO global config.
    prevHome = process.env.KARAJAN_HOME;
    process.env.KARAJAN_HOME = mkdtempSync(join(tmpdir(), "kj-home-"));
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    if (process.env.KARAJAN_HOME) rmSync(process.env.KARAJAN_HOME, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.KARAJAN_HOME;
    else process.env.KARAJAN_HOME = prevHome;
  });

  it("E) throws when local config exists without a global counterpart", async () => {
    mkdirSync(join(projectDir, ".karajan"));
    writeFileSync(join(projectDir, ".karajan", "kj.config.yml"), "roles:\n  coder:\n    provider: opencode\n");
    await expect(loadConfig(projectDir)).rejects.toThrow(/Local config found.*no global config/);
  });
});
