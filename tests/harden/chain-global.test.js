// KJC-TSK-0645: kj harden points core.hooksPath at .karajan/hooks, which
// ECLIPSES the user's global hooks dir — silently disabling personal guards
// (AI-attribution commit-msg, protected-branch pre-push). Reproduced twice
// in the field. The generated hooks must chain the previous global hook,
// guarded so machines without one are unaffected.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { hookBody, PROFILE_HOOKS } from "../../src/harden/hook-templates.js";
import { installHooks } from "../../src/harden/harden-engine.js";

describe("hookBody chain-to-global", () => {
  it("every profile hook delegates to the global hook when a dir is given", () => {
    for (const hook of PROFILE_HOOKS.standard) {
      const body = hookBody(hook, {}, { globalHooksDir: "$HOME/.git-hooks" });
      expect(body).toContain(`[ -x "$HOME/.git-hooks/${hook}" ]`);
      expect(body).toContain(`"$HOME/.git-hooks/${hook}" "$@"; rc=$?`);
      expect(body).toContain('[ "$rc" -eq 0 ] || exit "$rc"');
    }
  });

  it("no global dir → no chain block", () => {
    expect(hookBody("commit-msg", {})).not.toMatch(/Chain the machine/);
  });
});

describe("installHooks detects the previous global hooksPath (e2e)", () => {
  let dir, fakeGitConfig, prevEnv;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-chain-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    // Never touch the developer's real ~/.gitconfig: point git at a fake one.
    fakeGitConfig = path.join(dir, "fake-gitconfig");
    fs.writeFileSync(fakeGitConfig, "[core]\n\thooksPath = ~/.git-hooks\n");
    prevEnv = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = fakeGitConfig;
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = prevEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("generated hooks chain to the detected global dir", async () => {
    await installHooks({ projectDir: dir });
    const commitMsg = fs.readFileSync(path.join(dir, ".karajan", "hooks", "commit-msg"), "utf8");
    expect(commitMsg).toContain('[ -x "$HOME/.git-hooks/commit-msg" ]');
  });

  it("no global hooksPath configured → hooks have no chain block", async () => {
    fs.writeFileSync(fakeGitConfig, "");
    await installHooks({ projectDir: dir });
    const commitMsg = fs.readFileSync(path.join(dir, ".karajan", "hooks", "commit-msg"), "utf8");
    expect(commitMsg).not.toMatch(/Chain the machine/);
  });
});
