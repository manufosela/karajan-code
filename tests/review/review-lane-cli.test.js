// HU-4124: proves `kj review --lane` is wired in the real CLI, not only that resolveLaneDir works.
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
  main = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-lane-cli-")));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-lane-home-"));
  initRepo(main);
});
afterEach(() => {
  fs.rmSync(main, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});
describe("kj review --lane (CLI wiring)", () => {
  it("accepts --lane and fails naming a lane that does not exist", () => {
    const res = kj("review", "--check", "--lane", "no-such-lane");
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("no-such-lane");
  });
  it("acts on the lane's staged diff from the main checkout, and on the main tree without --lane", () => {
    const lane = path.join(main, ".kj", "worktrees", "lane-a");
    initRepo(lane);
    fs.writeFileSync(path.join(lane, "staged.js"), "export const a = 1;\n");
    git(lane, "add", "staged.js");
    const withLane = kj("review", "--check", "--lane", "lane-a");
    const without = kj("review", "--check");
    expect(withLane.out).toContain("staged.js");
    expect(without.out).not.toContain("staged.js");
  });
});
