// HU-4268 (#4259): the base kj works against: an explicit base_branch, then origin/HEAD, then main.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BASE_EXPLICIT, baseBranchFrom, resolveBaseBranch } from "../../src/config/base-branch.js";
import { loadConfig } from "../../src/config.js";
import { worktreeCommand } from "../../src/commands/worktree.js";

let dir;
const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
const quiet = { info: () => {} };
const loaded = (explicit, base) => async () => ({ config: { base_branch: base }, baseBranchExplicit: explicit });

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-hu4268-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** A repo whose only branch is develop, the remote's default; no local main. */
function developOnly() {
  git("init", "-q", "-b", "develop");
  fs.writeFileSync(path.join(dir, "a.js"), "x\n");
  git("add", "a.js");
  git("commit", "-qm", "base");
  git("remote", "add", "origin", "https://example.invalid/r.git");
  git("update-ref", "refs/remotes/origin/develop", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
}

describe("resolveBaseBranch", () => {
  it("an explicit base_branch wins over origin/HEAD", async () => {
    developOnly();
    expect(await resolveBaseBranch(dir, { load: loaded(true, "release"), logger: quiet })).toBe("release");
  });

  it("origin/HEAD gives its branch when nobody set base_branch", async () => {
    developOnly();
    expect(await resolveBaseBranch(dir, { load: loaded(false, "main"), logger: quiet })).toBe("develop");
  });

  it("a main that exists locally does not beat origin/HEAD develop", async () => {
    developOnly();
    git("branch", "main");
    expect(await resolveBaseBranch(dir, { load: loaded(false, "main"), logger: quiet })).toBe("develop");
  });

  it("neither gives main and says how to fix it", async () => {
    git("init", "-q");
    const said = [];
    expect(await resolveBaseBranch(dir, { load: loaded(false, "main"), logger: { info: (m) => said.push(m) } })).toBe("main");
    expect(said[0]).toMatch(/set-head origin -a/);
  });
});

describe("baseBranchFrom", () => {
  it("reads the flag loadConfig leaves on the config, and the flag never serializes", async () => {
    developOnly();
    const { config } = await loadConfig(dir);
    expect(config[BASE_EXPLICIT]).toBe(false);
    expect(JSON.stringify(config)).not.toContain("baseBranchExplicit");
    expect(baseBranchFrom({ config, projectDir: dir, logger: quiet })).toBe("develop");
  });

  it("says the origin/HEAD base once on stderr", () => {
    developOnly();
    const said = [];
    baseBranchFrom({ config: null, projectDir: dir, logger: { info: (m) => said.push(m) } });
    expect(said).toEqual(["kj: base branch develop (from origin/HEAD)"]);
  });

  it("names the command that asked in the fallback note, kj by default", () => {
    git("init", "-q", "-b", "main");
    const said = [];
    const logger = { info: (m) => said.push(m) };
    baseBranchFrom({ config: null, projectDir: dir, logger, label: "kj steward" });
    baseBranchFrom({ config: null, projectDir: dir, logger });
    expect(said[0]).toMatch(/^kj steward: could not read the default branch/);
    expect(said[1]).toMatch(/^kj: could not read the default branch/);
  });
});

describe("kj worktree start with origin/HEAD develop and no main", () => {
  it("cuts the lane from origin/develop", async () => {
    developOnly();
    const r = await worktreeCommand({ config: { projectDir: dir }, action: "start", args: ["lane-x"], flags: {} });
    expect(fs.existsSync(r.path)).toBe(true);
    expect(r.branch).toBe("feat/lane-x");
  });
});
