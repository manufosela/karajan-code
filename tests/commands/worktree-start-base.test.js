// KJC-TSK-1647 (HU-4424): `kj worktree start <slug> --base <branch>`. maxwell works a project on an
// epic branch: every issue's lane must start from it, and its PR goes against it; the lane started
// from the configured base instead, so the PR carried changes that were not its own.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { worktreeCommand } from "../../src/commands/worktree.js";
import { baseBranchFrom } from "../../src/config/base-branch.js";

let dir;
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-wt-base-")));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.js"), "x\n");
  git(dir, "add", "a.js");
  git(dir, "commit", "-qm", "base");
  git(dir, "checkout", "-q", "-b", "epic/ficha");
  fs.writeFileSync(path.join(dir, "epic.js"), "e\n");
  git(dir, "add", "epic.js");
  git(dir, "commit", "-qm", "epic work");
  git(dir, "checkout", "-q", "main");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const start = (slug, flags) => worktreeCommand({ config: { projectDir: dir }, action: "start", args: [slug], flags });

describe("kj worktree start --base", () => {
  it("cuts the lane from the given branch and keeps it as the lane's base", async () => {
    const r = await start("issue-7", { base: "epic/ficha" });
    expect(git(r.path, "rev-parse", "HEAD")).toBe(git(dir, "rev-parse", "epic/ficha"));
    expect(baseBranchFrom({ projectDir: r.path, announce: false })).toBe("epic/ficha");
  });

  it("the base stays the lane's: the main checkout and another lane keep their own", async () => {
    await start("issue-7", { base: "epic/ficha" });
    const plain = await start("issue-8", {});
    expect(baseBranchFrom({ projectDir: dir, announce: false, logger: {} })).toBe("main");
    expect(baseBranchFrom({ projectDir: plain.path, announce: false, logger: {} })).toBe("main");
  });

  it("a branch that does not exist fails naming it, and no lane is made", async () => {
    await expect(start("issue-9", { base: "epic/nope" })).rejects.toThrow(/epic\/nope/);
    expect(fs.existsSync(path.join(dir, ".kj", "worktrees", "issue-9"))).toBe(false);
  });
});
