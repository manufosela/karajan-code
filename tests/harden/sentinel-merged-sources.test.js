// HU-4003 (KJC-BUG-0562): a recorded source counts only while it is still pending in its tree
// (uncommitted, or committed on HEAD and not on origin/<base>). Merged sources let the turn end.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIB = fileURLToPath(new URL("../../src/harden/sentinel/sentinel-lib.mjs", import.meta.url));
const PROBE = "const m = await import(process.argv[1]); const a = JSON.parse(process.argv[2]);"
  + " console.log(JSON.stringify(m.violations(a.s, a.branch, [], a.top)));";
const NO_CARD = /no referencia ninguna card/;

describe("Stop gate and merged sources — HU-4003", () => {
  let tmp;
  let repo;
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const judge = (sources, top = repo, branch = "HEAD") => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", PROBE, LIB,
    JSON.stringify({ s: { edited_sources: sources, edited_tests: [] }, branch, top })], { cwd: repo, encoding: "utf8" }).trim());
  const write = (rel, text) => fs.writeFileSync(path.join(repo, rel), text);

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-sentinel-merged-")));
    repo = path.join(tmp, "repo");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    fs.mkdirSync(path.join(repo, "src"));
    write("src/a.js", "export const a = 1;\n");
    git("add", "src/a.js");
    git("commit", "-qm", "base");
    write("src/a.js", "export const a = 2;\n");
    git("commit", "-qam", "merged work");
    git("update-ref", "refs/remotes/origin/main", "HEAD"); // what a fetch after the merge leaves
    git("checkout", "-q", "--detach", "origin/main");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("merged sources with a detached HEAD at origin/main: no violation", () => {
    expect(judge(["src/a.js"])).toEqual([]);
  });

  it("an uncommitted recorded source on a branch without a card: a violation, as today", () => {
    write("src/a.js", "export const a = 3;\n");
    expect(judge(["src/a.js"]).join("\n")).toMatch(NO_CARD);
  });

  it("an untracked recorded source is pending too", () => {
    write("src/b.js", "export const b = 1;\n");
    expect(judge(["src/a.js", "src/b.js"]).join("\n")).toMatch(NO_CARD);
  });

  it("committed on HEAD but not on origin/main: a violation, as today", () => {
    write("src/a.js", "export const a = 4;\n");
    git("commit", "-qam", "unmerged");
    expect(judge(["src/a.js"]).join("\n")).toMatch(NO_CARD);
  });

  it("a git error counts the sources as pending (fail closed)", () => {
    const notRepo = path.join(tmp, "not-a-repo");
    fs.mkdirSync(notRepo);
    expect(judge(["src/a.js"], notRepo).join("\n")).toMatch(NO_CARD);
  });

  it("no origin/<base> to measure against counts the sources as pending (fail closed)", () => {
    git("update-ref", "-d", "refs/remotes/origin/main");
    expect(judge(["src/a.js"]).join("\n")).toMatch(NO_CARD);
  });

  // A name holding a newline: git's line output spells it otherwise, and it must not slip past.
  const ODD = "src/odd\nname.js";
  const commitOdd = () => { write(ODD, "export const odd = 1;\n"); git("add", "--", ODD); git("commit", "-qm", "odd"); };
  const mergeOdd = () => { commitOdd(); git("update-ref", "refs/remotes/origin/main", "HEAD"); };
  it.each([
    ["uncommitted", () => { mergeOdd(); write(ODD, "export const odd = 2;\n"); }],
    ["untracked", () => write(ODD, "export const odd = 1;\n")],
    ["committed and not merged", commitOdd],
  ])("a recorded source whose name holds a newline is pending while %s", (_label, arrange) => {
    arrange();
    expect(judge([ODD]).join("\n")).toMatch(NO_CARD);
  });

  it("merged, a source whose name holds a newline lets the turn end", () => {
    mergeOdd();
    expect(judge([ODD])).toEqual([]);
  });

  // A repository that keeps both bases, one behind the other: the work is measured against the lane's own.
  const point = (main, master) => { git("update-ref", "refs/remotes/origin/main", main); git("update-ref", "refs/remotes/origin/master", master); };
  it("on master, the base is origin/master whatever origin/main holds", () => {
    git("checkout", "-q", "-b", "master");
    point("HEAD~1", "HEAD");
    expect(judge(["src/a.js"], repo, "master")).toEqual([]);
    point("HEAD", "HEAD~1");
    expect(judge(["src/a.js"], repo, "master").join("\n")).toMatch(/rama base 'master'/);
  });

  it("off a base branch, origin/HEAD names the base", () => {
    point("HEAD~1", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master");
    expect(judge(["src/a.js"])).toEqual([]);
    point("HEAD", "HEAD~1");
    expect(judge(["src/a.js"]).join("\n")).toMatch(NO_CARD);
  });

  it("off a base branch with no origin/HEAD, the work must be on every base origin has", () => {
    point("HEAD", "HEAD");
    expect(judge(["src/a.js"])).toEqual([]);
    point("HEAD", "HEAD~1");
    expect(judge(["src/a.js"]).join("\n")).toMatch(NO_CARD);
  });
});
