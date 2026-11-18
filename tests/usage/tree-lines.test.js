// HU-4619: the lines kj code's coder adds and removes, for the usage record.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linesSince, treeLines } from "../../src/usage/tree-lines.js";

let repo;
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "kj-tree-lines-"));
  git("init", "-q");
  fs.writeFileSync(path.join(repo, "a.js"), "one\ntwo\nthree\n");
  git("add", "a.js");
  git("commit", "-qm", "init");
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe("treeLines (HU-4619)", () => {
  it("counts edits against HEAD and the lines of new untracked text files, not binaries", () => {
    fs.writeFileSync(path.join(repo, "a.js"), "one\nTWO\n");
    fs.writeFileSync(path.join(repo, "b.js"), "x\ny\n");
    fs.writeFileSync(path.join(repo, "c.bin"), Buffer.from([0, 1, 2]));
    expect(treeLines(repo)).toEqual({ added: 3, removed: 2 });
  });

  it("leaves out kj's own state (.kj and .karajan) even where the repo does not ignore it", () => {
    fs.mkdirSync(path.join(repo, ".kj"));
    fs.mkdirSync(path.join(repo, ".karajan"));
    fs.writeFileSync(path.join(repo, ".kj", "run.log"), "a\nb\n");
    fs.writeFileSync(path.join(repo, ".karajan", "trace.jsonl"), "{}\n");
    expect(treeLines(repo)).toEqual({ added: 0, removed: 0 });
  });

  it("fails loudly outside a git repo", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "kj-tree-lines-none-"));
    try {
      expect(() => treeLines(bare)).toThrow();
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("linesSince (HU-4619)", () => {
  it("measures only what changed after the baseline, never below zero", () => {
    fs.writeFileSync(path.join(repo, "a.js"), "one\ntwo\nthree\nfour\n");
    const measure = linesSince(repo, treeLines(repo));
    fs.writeFileSync(path.join(repo, "b.js"), "x\ny\n");
    expect(measure()).toEqual({ linesAdded: 2, linesRemoved: 0 });
    fs.writeFileSync(path.join(repo, "a.js"), "one\ntwo\nthree\n");
    fs.rmSync(path.join(repo, "b.js"));
    expect(measure()).toEqual({ linesAdded: 0, linesRemoved: 0 });
  });
});
