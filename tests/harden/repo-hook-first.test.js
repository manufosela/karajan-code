// HU-3605: the repo's own pre-commit (.git/hooks) runs BEFORE the review gate, so what it
// modifies and re-stages is already part of the diff the recorded verdict covers.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { hookBody } from "../../src/harden/hook-templates.js";
import { SYSTEM_PATH } from "./_fake-kj.js";

describe("pre-commit: repo hook before the review gate", () => {
  let repo;
  let seen;
  let env;
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, stdio: "pipe" });
  const repoHook = (script) => fs.writeFileSync(path.join(repo, ".git", "hooks", "pre-commit"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  const runHook = () => spawnSync("sh", [path.join(repo, "kj-pre-commit")], { cwd: repo, env, encoding: "utf8" });

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kj-repo-first-"));
    git("init", "-q");
    fs.mkdirSync(path.join(repo, ".karajan"));
    fs.writeFileSync(path.join(repo, ".karajan", "review-gate"), "on\n");
    fs.writeFileSync(path.join(repo, "a.txt"), "base\n");
    git("add", ".karajan/review-gate", "a.txt");
    git("commit", "-q", "-m", "init");
    fs.appendFileSync(path.join(repo, "a.txt"), "staged\n");
    git("add", "a.txt");
    fs.writeFileSync(path.join(repo, "kj-pre-commit"), `#!/bin/sh\nset -e\n${hookBody("pre-commit", {}, {})}\n`);
    seen = path.join(repo, "gate-saw.txt");
    const bin = fs.mkdtempSync(path.join(repo, "bin-kj-"));
    // The fake gate records the staged content it is asked to judge, and refuses (no verdict).
    fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\n[ "$1" = review ] && { git show :a.txt > "${seen}"; exit 1; }\nexit 0\n`, { mode: 0o755 });
    env = { ...process.env, PATH: `${bin}:${SYSTEM_PATH}`, GIT_CONFIG_GLOBAL: path.join(repo, "none") };
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("the gate sees what the repo hook modified and re-staged, and still refuses without a verdict", () => {
    repoHook("echo from-repo-hook >> a.txt\ngit add a.txt\nexit 0");
    const res = runHook();
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("no approved cross-AI verdict");
    expect(fs.readFileSync(seen, "utf8")).toBe("base\nstaged\nfrom-repo-hook\n");
  });

  it("a failing repo hook fails the commit and the gate is never reached", () => {
    repoHook("echo from-repo-hook >> a.txt\ngit add a.txt\nexit 1");
    const res = runHook();
    expect(res.status).toBe(1);
    expect(res.stdout).not.toContain("no approved cross-AI verdict");
    expect(fs.existsSync(seen)).toBe(false);
  });
});
