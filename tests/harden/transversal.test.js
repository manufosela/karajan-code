// ADR 0055 step 1 (KJC-TSK-1558): a transversal parent (a non-repo folder with a
// .claude-transversal marker) and the child repo each path under it belongs to.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { childRepoOf, childReposOf, transversalRoot } from "../../src/harden/transversal.mjs";

const gitInit = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  return fs.realpathSync(dir);
};

describe("transversal parent and child repos (ADR 0055)", () => {
  let parent, alpha, beta;
  beforeEach(() => {
    parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-transversal-")));
    fs.writeFileSync(path.join(parent, ".claude-transversal"), "");
    fs.writeFileSync(path.join(parent, "notes.md"), "parent's own file\n");
    alpha = gitInit(path.join(parent, "alpha"));
    beta = gitInit(path.join(parent, "group", "beta"));
    fs.writeFileSync(path.join(alpha, "a.js"), "");
    fs.writeFileSync(path.join(beta, "b.js"), "");
  });
  afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

  it("finds the marked parent walking up from a folder under it", () => {
    expect(transversalRoot(parent)).toBe(parent);
    expect(transversalRoot(path.join(parent, "group"))).toBe(parent);
  });

  it("maps a file in each child to that child, nested ones included", () => {
    expect(childRepoOf(path.join(alpha, "a.js"), parent)).toBe(alpha);
    expect(childRepoOf(path.join(beta, "b.js"), parent)).toBe(beta);
  });

  it("maps a new file in a not-yet-existing subfolder to its child", () => {
    expect(childRepoOf(path.join(alpha, "src", "deep", "new.js"), parent)).toBe(alpha);
  });

  it("maps the parent's own file and a path outside the parent to null", () => {
    expect(childRepoOf(path.join(parent, "notes.md"), parent)).toBeNull();
    expect(childRepoOf(path.join(parent, "group", "loose.md"), parent)).toBeNull();
    expect(childRepoOf(os.tmpdir(), parent)).toBeNull();
  });

  it("does not count a marker inside a git repo", () => {
    fs.writeFileSync(path.join(alpha, ".claude-transversal"), "");
    expect(transversalRoot(path.join(alpha, "src"))).toBe(parent);
    const lone = gitInit(fs.mkdtempSync(path.join(os.tmpdir(), "kj-marked-repo-")));
    fs.writeFileSync(path.join(lone, ".claude-transversal"), "");
    try { expect(transversalRoot(lone)).toBeNull(); }
    finally { fs.rmSync(lone, { recursive: true, force: true }); }
  });

  it("is null with no marker anywhere", () => {
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-unmarked-")));
    try { expect(transversalRoot(bare)).toBeNull(); }
    finally { fs.rmSync(bare, { recursive: true, force: true }); }
  });

  it("lists the distinct child repos of a call's paths", () => {
    const both = childReposOf([path.join(alpha, "a.js"), path.join(beta, "b.js"), path.join(alpha, "x.js")], parent);
    expect(both).toEqual({ repos: [alpha, beta], stray: [] });
  });

  it("returns the child plus the path that falls in none", () => {
    const stray = path.join(parent, "notes.md");
    expect(childReposOf([path.join(alpha, "a.js"), stray], parent)).toEqual({ repos: [alpha], stray: [stray] });
  });
});
