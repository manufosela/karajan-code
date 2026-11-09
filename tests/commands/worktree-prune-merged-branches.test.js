// KJC-TSK-1480: every local branch already whole in the base, and out of every worktree, goes.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { worktreeCommand } from "../../src/commands/worktree.js";

let dir;
const git = (...args) => execFileSync("git", ["-C", dir, ...args]).toString();
const prune = (flags = {}, processes = { cwds: new Set(), unseen: 0 }) => worktreeCommand({ config: { projectDir: dir }, action: "prune", args: [], flags, deps: { processes } });
const branches = () => git("branch", "--format=%(refname:short)").trim().split("\n").toSorted();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-wtmerged-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.js"), "x\n");
  git("add", "a.js"); git("commit", "-qm", "base");
  git("branch", "feat/merged");
  git("checkout", "-q", "-b", "feat/work");
  fs.writeFileSync(path.join(dir, "b.js"), "y\n");
  git("add", "b.js"); git("commit", "-qm", "work");
  git("checkout", "-q", "main");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("kj worktree prune and merged local branches (KJC-TSK-1480)", () => {
  it("deletes the merged ones; keeps the base, one with work and one a live lane has out", async () => {
    const busy = (await worktreeCommand({ config: { projectDir: dir }, action: "start", args: ["busy"], flags: {} })).path;
    const r = await prune({}, { cwds: new Set([busy]), unseen: 0 });
    expect(r.mergedBranchesRemoved).toEqual(["feat/merged"]);
    expect(branches()).toEqual(["feat/busy", "feat/work", "main"]);
  });

  it("a dry run only counts them", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await prune({ dryRun: true });
    expect(r.wouldRemoveMerged).toEqual(["feat/merged"]);
    expect(log).toHaveBeenCalledWith("would delete 1 local branch(es) already in main");
    expect(branches()).toEqual(["feat/merged", "feat/work", "main"]);
    log.mockRestore();
  });
});
