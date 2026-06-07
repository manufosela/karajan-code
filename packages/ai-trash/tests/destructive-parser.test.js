// Tests for the destructive-command parser (KJC-TSK-0390 commit 1).

import { describe, it, expect } from "vitest";
import { classifyCommand, tokenise } from "../src/destructive-parser.js";

describe("tokenise", () => {
  it("splits whitespace and preserves quoted segments", () => {
    expect(tokenise(`rm -rf "/tmp/dir with space"`)).toEqual(["rm", "-rf", "/tmp/dir with space"]);
  });
  it("returns the array unchanged when already tokenised", () => {
    expect(tokenise(["rm", "a"])).toEqual(["rm", "a"]);
  });
  it("returns empty for non-string non-array input", () => {
    expect(tokenise(null)).toEqual([]);
    expect(tokenise(42)).toEqual([]);
  });
});

describe("classifyCommand — rm", () => {
  it("flags rm -rf as recursive + force", () => {
    const r = classifyCommand("rm -rf node_modules dist");
    expect(r).toMatchObject({ destructive: true, kind: "rm", recursive: true, force: true, paths: ["node_modules", "dist"] });
  });
  it("flags bare rm as destructive without recursive flag", () => {
    const r = classifyCommand("rm a.txt");
    expect(r).toMatchObject({ destructive: true, recursive: false, paths: ["a.txt"] });
  });
});

describe("classifyCommand — truncate / redirect", () => {
  it("flags truncate -s 0 as destructive", () => {
    expect(classifyCommand("truncate -s 0 log.txt")).toMatchObject({ destructive: true, kind: "truncate", paths: ["log.txt"] });
  });
  it("flags > redirect as clobber even mid-command", () => {
    expect(classifyCommand("echo hi > out.log")).toMatchObject({ destructive: true, kind: "redirect-clobber", paths: ["out.log"] });
  });
});

describe("classifyCommand — mv / cp", () => {
  it("flags mv with src+dst as overwrite candidate", () => {
    expect(classifyCommand("mv a.txt b.txt")).toMatchObject({ destructive: true, kind: "mv-overwrite", paths: ["b.txt"] });
  });
  it("does not flag mv with a single arg as destructive", () => {
    expect(classifyCommand("mv a.txt").destructive).toBe(false);
  });
});

describe("classifyCommand — git destructive corners", () => {
  it("flags git reset --hard", () => {
    expect(classifyCommand("git reset --hard HEAD~3").kind).toBe("git-reset-hard");
  });
  it("flags git clean -fd / -xdf", () => {
    expect(classifyCommand("git clean -fd").kind).toBe("git-clean");
    expect(classifyCommand("git clean -xdf").kind).toBe("git-clean");
  });
  it("flags git branch -D", () => {
    expect(classifyCommand("git branch -D feat/old").kind).toBe("git-branch-D");
  });
  it("flags git push --force / --force-with-lease", () => {
    expect(classifyCommand("git push --force origin main").kind).toBe("git-push-force");
    expect(classifyCommand("git push --force-with-lease").kind).toBe("git-push-force");
  });
  it("flags git checkout -- file (discard local edits)", () => {
    expect(classifyCommand("git checkout -- src/a.js").kind).toBe("git-checkout-discard");
  });
  it("does NOT flag git status / log / fetch", () => {
    expect(classifyCommand("git status").destructive).toBe(false);
    expect(classifyCommand("git log -n 5").destructive).toBe(false);
    expect(classifyCommand("git fetch origin").destructive).toBe(false);
  });
});

describe("classifyCommand — safe + edge cases", () => {
  it("returns safe for an unrelated head", () => {
    expect(classifyCommand("ls -la").destructive).toBe(false);
    expect(classifyCommand("npm install").destructive).toBe(false);
  });
  it("returns empty kind for empty input", () => {
    expect(classifyCommand("").kind).toBe("empty");
    expect(classifyCommand([]).kind).toBe("empty");
  });
});
