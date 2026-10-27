// #2566: `kj worktree start` run inside a lane created a lane nested in it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mainCheckout } from "../../src/utils/main-checkout.js";

let dir;
let main;
let lane;
// A repo with one commit (src/a.js) at `at`; extra flags go to `git init`.
const initRepo = (at, ...initFlags) => {
  fs.mkdirSync(path.join(at, "src"), { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", at, ...args]);
  git("init", "-q", "-b", "main", ...initFlags);
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(at, "src", "a.js"), "x\n");
  git("add", "."); git("commit", "-qm", "base");
  return git;
};
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-main-"));
  main = path.join(dir, "repo");
  lane = path.join(main, ".kj", "worktrees", "lane");
  initRepo(main)("worktree", "add", "-q", "-b", "feat/lane", lane);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const real = (p) => fs.realpathSync(p);

describe("mainCheckout", () => {
  it("is the toplevel of the main checkout from the root, a lane, or a subfolder of either", () => {
    for (const from of [main, path.join(main, "src"), lane, path.join(lane, "src")]) {
      expect(mainCheckout(from)).toBe(real(main));
    }
  });

  it("finds the main checkout from a lane of a --separate-git-dir repo", () => {
    const sep = path.join(dir, "sep");
    const sepLane = path.join(sep, ".kj", "worktrees", "lane");
    initRepo(sep, "--separate-git-dir", path.join(dir, "store.git"))("worktree", "add", "-q", "-b", "feat/lane", sepLane);
    expect(mainCheckout(sep)).toBe(real(sep));
    expect(mainCheckout(sepLane)).toBe(real(sep));
  });

  it("finds the main checkout from a linked worktree that sits beside it, not under it", () => {
    const beside = path.join(dir, "beside");
    execFileSync("git", ["-C", main, "worktree", "add", "-q", "-b", "feat/beside", beside]);
    // a file only the lane's branch has, sorting before main's own files
    fs.writeFileSync(path.join(beside, "0-lane-only.js"), "y\n");
    execFileSync("git", ["-C", beside, "add", "."]);
    fs.rmSync(path.join(main, "src", "a.js")); // an unstaged deletion in the main checkout
    expect(mainCheckout(beside)).toBe(real(main));
  });

  it("is not fooled by a separate git dir that is itself called .git", () => {
    const app = path.join(dir, "app");
    fs.mkdirSync(path.join(dir, "metadata"));
    initRepo(app, "--separate-git-dir", path.join(dir, "metadata", ".git"));
    expect(mainCheckout(app)).toBe(real(app));
  });

  it("fails loudly for an external linked worktree of a --separate-git-dir repo", () => {
    // (a separate dir named ".git" is, to git itself, the plain checkout of its parent: not resolvable)
    const outside = path.join(dir, "outside");
    initRepo(path.join(dir, "app"), "--separate-git-dir", path.join(dir, "store.git"))("worktree", "add", "-q", "-b", "feat/out", outside);
    expect(() => mainCheckout(outside)).toThrow(/separate/);
  });

  it("refuses a bare repo, loudly", () => {
    const bare = path.join(dir, "bare.git");
    execFileSync("git", ["init", "-q", "--bare", bare]);
    expect(() => mainCheckout(bare)).toThrow(/bare/);
  });

  it("returns the dir unchanged outside a git repo", () => {
    const plain = path.join(dir, "plain");
    fs.mkdirSync(plain);
    expect(mainCheckout(plain)).toBe(plain);
  });

  it("knows a dir is outside git whatever language git speaks (KJC-BUG-0409)", () => {
    // A git that answers in Spanish unless kj asks for the C locale.
    const bin = path.join(dir, "fakebin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "git"), [
      "#!/bin/sh",
      'if [ "$LC_ALL" = C ]; then echo "fatal: not a git repository" >&2;',
      'else echo "fatal: no es un repositorio git" >&2; fi',
      "exit 128",
    ].join("\n"), { mode: 0o755 });
    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
    try {
      expect(mainCheckout(dir)).toBe(dir);
    } finally {
      process.env.PATH = savedPath;
    }
  });
});
