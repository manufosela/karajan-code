// KJC-TSK-1206 (ADR 0030, step 5c): what runs is the guard of the installed kj,
// so what is verified is the wiring that calls it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { installHarnessHooks } from "../../src/harden/harness-hooks.js";
import { installSentinelHooks, verifySentinelScripts } from "../../src/harden/sentinel-hooks.js";
import { wireLegacy } from "./_legacy-wiring.js";
import { placeGuardCopies } from "./_guard-copies.js";

const quiet = { info: () => {}, warn: () => {} };

describe("sentinel verify over the wiring", () => {
  let dir;
  let settingsPath;
  const settings = () => JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const rewrite = (fn) => {
    const cfg = settings();
    fn(cfg.hooks);
    fs.writeFileSync(settingsPath, JSON.stringify(cfg));
  };
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-wiring-")));
    execFileSync("git", ["init", "-q", dir]);
    installHarnessHooks({ projectDir: dir, logger: quiet });
    installSentinelHooks({ projectDir: dir, logger: quiet, gitShowFn: () => "{}" });
    settingsPath = path.join(dir, ".claude", "settings.json");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("a project wired to the package runner verifies by its wiring", () => {
    expect(verifySentinelScripts({ projectDir: dir, gitShowFn: () => "{}" })).toMatchObject({ ok: true, wiring: true });
  });

  it("a hook rewired to anything else is tampering, named by event and guard", () => {
    rewrite((hooks) => { hooks.Stop[0].hooks[0].command = "true"; });
    const res = verifySentinelScripts({ projectDir: dir, gitShowFn: () => "{}" });
    expect(res.ok).toBe(false);
    expect(res.mismatched).toContain("Stop → stop");
  });

  it("narrowing a guard meant for every tool to one matcher is tampering too", () => {
    rewrite((hooks) => {
      const rules = hooks.PreToolUse.find((e) => /pretooluse-rules;/.test(JSON.stringify(e)));
      rules.matcher = "Read";
    });
    expect(verifySentinelScripts({ projectDir: dir, gitShowFn: () => "{}" }).mismatched).toContain("PreToolUse → pretooluse-rules");
  });

  it("a project still wired to node and its own copies is verified by those files, as before", () => {
    placeGuardCopies(dir);
    wireLegacy(dir);
    const res = verifySentinelScripts({ projectDir: dir, gitShowFn: () => "{}" });
    expect(res.ok).toBe(true);
    expect(res.wiring).toBeUndefined();
  });

  it("emptied or unreadable settings run no guard at all: that fails, it never falls back to the files", () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }));
    const emptied = verifySentinelScripts({ projectDir: dir, gitShowFn: () => "{}" });
    expect(emptied.ok).toBe(false);
    expect(emptied.mismatched).toContain("Stop → stop");
    fs.writeFileSync(settingsPath, "{ not json");
    expect(verifySentinelScripts({ projectDir: dir, gitShowFn: () => "{}" }).ok).toBe(false);
  });
});
