// KJC-BUG-0447 (issue #2655): `kj review --install-gate` said the gate was on
// when ANY core.hooksPath was set — even a global one with no pre-commit — so
// a REJECTED diff committed without a word. The gate is on only when the
// pre-commit git will actually run calls `kj review --check`.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gateHookStatus } from "../../src/review/gate-hook.js";

let dir;
const SAVED_GLOBAL = process.env.GIT_CONFIG_GLOBAL;
const git = (...args) => execFileSync("git", args, { cwd: dir });
const writeHook = (rel, body, mode = 0o755) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body, { mode });
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gatehook-"));
  // the machine's global git config (a personal core.hooksPath, say) must not leak in
  fs.writeFileSync(path.join(dir, "empty-gitconfig"), "");
  process.env.GIT_CONFIG_GLOBAL = path.join(dir, "empty-gitconfig");
  git("init", "-q", "-b", "main");
});
afterEach(() => {
  if (SAVED_GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = SAVED_GLOBAL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("gateHookStatus", () => {
  it("a hooks path with no pre-commit (a global ~/.git-hooks, say) does not enforce the gate", () => {
    fs.mkdirSync(path.join(dir, "global-hooks"));
    git("config", "core.hooksPath", path.join(dir, "global-hooks"));
    const s = gateHookStatus(dir);
    expect(s.enforced).toBe(false);
    expect(s.reason).toMatch(/no pre-commit/);
    expect(s.reason).toContain("global-hooks");
  });

  it("a pre-commit that never calls kj review --check does not enforce it", () => {
    writeHook(".git/hooks/pre-commit", "#!/bin/sh\nnpx lint-staged\n");
    const s = gateHookStatus(dir);
    expect(s.enforced).toBe(false);
    expect(s.reason).toMatch(/kj review --check/);
  });

  it.each([
    ["commented out", "# kj review --check || exit 1"],
    ["inside an echo", "echo 'run kj review --check || exit 1 first'"],
    ["with its failure ignored", "kj review --check || true"],
    ["that exits 0 on failure", "kj review --check || exit 0"],
    ["whose failure group never exits", "kj review --check || { echo 'review failed'; }"],
    ["whose group exits with the echo's status", "kj review --check || { echo 'review failed'; exit; }"],
    ["whose only exit is quoted text", "kj review --check || { echo 'then exit 1'; }"],
  ])("a call %s does not enforce it", (_label, line) => {
    writeHook(".git/hooks/pre-commit", `#!/bin/sh\n${line}\nnpx lint-staged\n`);
    expect(gateHookStatus(dir)).toMatchObject({ enforced: false, reason: expect.stringMatching(/kj review --check/) });
  });

  it("the line kj harden writes enforces it", () => {
    writeHook(".git/hooks/pre-commit", "#!/bin/sh\nif true; then\n  kj review --check || { echo 'kj: no approved verdict'; exit 1; }\nfi\n");
    expect(gateHookStatus(dir).enforced).toBe(true);
  });

  it("a pre-commit git cannot execute does not enforce it", () => {
    writeHook(".karajan/hooks/pre-commit", "#!/bin/sh\nkj review --check || exit 1\n", 0o644);
    git("config", "core.hooksPath", ".karajan/hooks");
    expect(gateHookStatus(dir)).toMatchObject({ enforced: false, reason: expect.stringMatching(/not executable/) });
  });

  it("the repo's hooks path with an executable pre-commit that runs the check enforces it", () => {
    writeHook(".karajan/hooks/pre-commit", "#!/bin/sh\nkj review --check || exit 1\n");
    git("config", "core.hooksPath", ".karajan/hooks");
    const s = gateHookStatus(dir);
    expect(s.enforced).toBe(true);
    expect(s.hooksDir).toBe(path.join(dir, ".karajan", "hooks"));
  });
});
