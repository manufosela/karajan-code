// HU-4123: proves `kj rag query --lane` is wired in the real CLI, not only that resolveLaneDir works.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const KJ = path.resolve("bin/kj.js");
let main, home;

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });
const kj = (...args) => {
  const res = spawnSync(process.execPath, [KJ, ...args], { cwd: main, encoding: "utf8", timeout: 60_000, env: { ...process.env, KARAJAN_HOME: home } });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
};
const initRepo = (dir) => { fs.mkdirSync(dir, { recursive: true }); git(dir, "init", "-q"); };

beforeEach(() => {
  main = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-rag-lane-cli-")));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rag-lane-home-"));
  initRepo(main);
});
afterEach(() => {
  fs.rmSync(main, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("kj rag query --lane (CLI wiring)", () => {
  it("accepts --lane and fails naming a lane that does not exist", () => {
    const res = kj("rag", "query", "x", "--lane", "no-such-lane");
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("no-such-lane");
  });

  it("answers for the lane's project (named in the empty-index warning), and for the main project without --lane", () => {
    initRepo(path.join(main, ".kj", "worktrees", "lane-a"));
    const withLane = kj("rag", "query", "x", "--lane", "lane-a");
    const without = kj("rag", "query", "x");
    expect(withLane.out).toContain("chunks of lane-a:");
    expect(without.out).not.toContain("lane-a");
    expect(without.out).toContain(`chunks of ${path.basename(main).toLowerCase()}:`);
  });
});
