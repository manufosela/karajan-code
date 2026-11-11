// HU-3831 (issue #3604) — two members of one class with the same name, kind and
// static-ness: the second silently overrides the first (grebla's two updated()).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findDuplicateMembers, sweepDuplicateMembers, MAX_BYTES } from "../../src/steward/duplicate-class-members.js";
import { benchDetector } from "../../src/steward/history-bench.js";

const dups = (src, file = "a.js") => findDuplicateMembers(src, file);
describe("findDuplicateMembers", () => {
  it("reports file, class, member and both lines", () => {
    const src = "class Tab {\n  updated() {}\n  render() {}\n  updated() {}\n}";
    expect(dups(src)).toEqual([{ file: "a.js", className: "Tab", member: "updated", kind: "method", static: false, lines: [2, 4] }]);
  });
  it("reports duplicate fields and duplicate getters", () => {
    const src = "class A {\n  x = 1;\n  x = 2;\n  get y() { return 1; }\n  get y() { return 2; }\n}";
    expect(dups(src).map((d) => [d.member, d.kind])).toEqual([["x", "field"], ["y", "getter"]]);
  });
  it("accepts a getter/setter pair, a static/instance pair and computed keys", () => {
    const src = "class A {\n  get v() { return 1; }\n  set v(x) {}\n  static f() {}\n  f() {}\n  [k]() {}\n  [k]() {}\n}";
    expect(dups(src)).toEqual([]);
  });
  it("accepts TypeScript overloads, reports a duplicated implementation", () => {
    const ok = "class A {\n  m(a: string): void;\n  m(a: number): void;\n  m(a: any) {}\n}";
    expect(dups(ok, "a.ts")).toEqual([]);
    const bad = "class A {\n  m(a: any) {}\n  m(a: any) {}\n}";
    expect(dups(bad, "a.ts")).toHaveLength(1);
  });
  it("does not see a class inside a string or a comment", () => {
    const src = "// class A { f() {} f() {} }\nconst s = 'class A { f() {} f() {} }';\n/* class B { g(){} g(){} } */";
    expect(dups(src)).toEqual([]);
  });
  it("throws on source that does not parse", () => {
    expect(() => dups("class {{{")).toThrow();
  });
});
describe("sweepDuplicateMembers", () => {
  it("skips and counts unparsable and oversized files, ignores non-JS files", () => {
    const files = { "ok.js": "class A { f(){} f(){} }", "bad.js": "class {{{", "big.js": "//" + "x".repeat(MAX_BYTES), "notes.md": "class A { f(){} f(){} }" };
    const r = sweepDuplicateMembers({ files: Object.keys(files), read: (f) => files[f] });
    expect(r.duplicates).toHaveLength(1);
    expect(r.unparsable).toBe(1);
    expect(r.skipped).toEqual({ too_large: 1 });
  });
});
describe("bench over a history", () => {
  let repo;
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
  const commit = (text, msg) => {
    fs.writeFileSync(path.join(repo, "tab.js"), text);
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", msg);
    return git("rev-parse", "HEAD");
  };
  const shas = [];
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kj-dup-"));
    git("init", "-q", "-b", "main");
    shas.push(commit("class T { updated() {} }", "healthy"));
    shas.push(commit("class T { updated() {} render() {} updated() {} }", "cause"));
    shas.push(commit("class T { updated() {} render() {} updated() {} x() {} }", "still broken"));
    shas.push(commit("class T { updated() {} render() {} }", "fix"));
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));
  it("first fires on the cause, stays on until the fix, quiet before", () => {
    const r = benchDetector({ repoDir: repo, range: "HEAD", detector: "duplicate-class-members" });
    expect(r.firings).toBe(2);
    expect(r.firstFiring).toEqual({ sha: shas[1], index: 1 });
  });
});
