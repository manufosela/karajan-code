// KJC-BUG-0285 (#1982): commits the coder made on its own are undone softly, so
// the pipeline commits what the review approves; a rewritten branch is left alone.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { headSha, undoCommitsSince } from "../src/git/coder-commit-guard.js";

let dir;
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
const commit = (file, msg) => { fs.writeFileSync(path.join(dir, file), `${msg}\n`); git("add", file); git("commit", "-qm", msg); };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-coder-guard-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "T");
  commit("a.txt", "first");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("coder commit guard", () => {
  it("undoes the coder's commits softly: HEAD back at the start, the changes staged", () => {
    const start = headSha(dir);
    commit("b.txt", "coder commit 1");
    commit("c.txt", "coder commit 2");
    expect(undoCommitsSince(start, dir)).toEqual({ undone: 2 });
    expect(headSha(dir)).toBe(start);
    expect(git("diff", "--cached", "--name-only").split("\n").sort()).toEqual(["b.txt", "c.txt"]);
  });

  it("does nothing when HEAD did not move, nor when the branch was rewritten", () => {
    const start = headSha(dir);
    expect(undoCommitsSince(start, dir)).toEqual({ undone: 0 });
    git("commit", "-q", "--amend", "-m", "rewritten");
    expect(undoCommitsSince(start, dir).undone).toBe(0);
    expect(headSha(dir)).not.toBe(start);
    expect(headSha(os.tmpdir())).toBeNull();
  });
});
