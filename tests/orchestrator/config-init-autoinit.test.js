/**
 * Regression pin for KJC-BUG-0060.
 *
 * The previous `autoInit()` guard only checked `existsSync(projectDir/.git)`.
 * That was insufficient: a `projectDir` pointing to a subdirectory of an
 * existing git repo would still pass the guard (no local `.git/`), causing
 * the subsequent `git commit --allow-empty -m "initial commit"` to resolve
 * upward and land an empty commit on the parent repo's main branch.
 *
 * The new guard runs `git rev-parse --is-inside-work-tree`, which follows
 * the same upward traversal that git would do for the commit itself, so
 * the two are guaranteed to agree.
 *
 * Acceptance:
 *   A) autoInit in subdir of repo → no .git/ created, no new commit on parent
 *   B) autoInit in clean dir (no parent repo) → git init runs, no seed commit
 *   C) autoInit in own repo → no-op, HEAD untouched
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { autoInit } from "../../src/orchestrator/config-init.js";

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function gitLog(cwd) {
  return execFileSync("git", ["log", "--oneline", "--all"], { cwd, encoding: "utf8" }).trim();
}

function gitInit(cwd) {
  execFileSync("git", ["init", "--quiet"], { cwd, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd, stdio: "pipe" });
}

describe("autoInit — KJC-BUG-0060 guard against empty-commit zombies", () => {
  let root;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kj-autoinit-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("A) does NOT commit to parent repo when projectDir is a subdir without its own .git", () => {
    gitInit(root);
    writeFileSync(join(root, "seed.txt"), "seed");
    execFileSync("git", ["add", "-A"], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "seed", "--quiet"], { cwd: root, stdio: "pipe" });
    const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

    const sub = join(root, "subdir-without-git");
    mkdirSync(sub);

    return autoInit(sub, silentLogger).then(() => {
      // No nested .git/ inside the subdir
      expect(existsSync(join(sub, ".git"))).toBe(false);
      // Parent HEAD unchanged — no zombie commit appended
      const headAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      expect(headAfter).toBe(headBefore);
      // And no "initial commit" anywhere in the parent log
      expect(gitLog(root)).not.toMatch(/initial commit/);
    });
  });

  it("B) runs git init in a clean dir (no parent repo) but does NOT create a seed commit", async () => {
    const fresh = join(root, "fresh");
    mkdirSync(fresh);
    // Disable upward discovery so the test is independent of the runner's cwd.
    process.env.GIT_CEILING_DIRECTORIES = root;
    try {
      await autoInit(fresh, silentLogger);
      expect(existsSync(join(fresh, ".git"))).toBe(true);
      // Repo exists but has no commits (no seed, no zombie)
      let threw = false;
      try {
        execFileSync("git", ["rev-parse", "HEAD"], { cwd: fresh, stdio: "pipe" });
      } catch { threw = true; }
      expect(threw).toBe(true);
    } finally {
      delete process.env.GIT_CEILING_DIRECTORIES;
    }
  });

  it("C) is a no-op when projectDir already has its own .git", async () => {
    gitInit(root);
    writeFileSync(join(root, "seed.txt"), "seed");
    execFileSync("git", ["add", "-A"], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "seed", "--quiet"], { cwd: root, stdio: "pipe" });
    const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

    await autoInit(root, silentLogger);

    const headAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    expect(headAfter).toBe(headBefore);
    expect(gitLog(root)).not.toMatch(/initial commit/);
  });
});
