import { describe, expect, it } from "vitest";
import { classifyLanes, liveProcesses, parseLsofCwds } from "../../src/hu/lane-prune.js";

const LSOF = "p101\nn/Users/me/proj\np202\nn/Users/me/other dir\n";

describe("parseLsofCwds (HU-3117)", () => {
  it("parses -Fpn output into pid/cwd pairs, keeping spaces in paths", () => {
    expect(parseLsofCwds(LSOF)).toEqual([
      { pid: 101, cwd: "/Users/me/proj" },
      { pid: 202, cwd: "/Users/me/other dir" },
    ]);
  });

  it("ignores a pid with no cwd line and unknown field lines", () => {
    expect(parseLsofCwds("p1\nfcwd\np2\nn/a\n")).toEqual([{ pid: 2, cwd: "/a" }]);
  });
});

describe("liveProcesses on darwin (HU-3117)", () => {
  it("returns {cwds, procs, unseen} from lsof, run with an args array and a timeout", () => {
    const calls = [];
    const run = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { status: 0, stdout: LSOF }; };
    const res = liveProcesses({ platform: "darwin", run, uid: 501 });
    expect(res.procs).toHaveLength(2);
    expect(res.cwds).toEqual(new Set(["/Users/me/proj", "/Users/me/other dir"]));
    expect(res.unseen).toBe(0);
    expect(calls[0].cmd).toBe("/usr/sbin/lsof");
    expect(calls[0].args).toEqual(["-a", "-d", "cwd", "-u", "501", "-Fpn"]);
    expect(calls[0].opts.timeout).toBeGreaterThan(0);
  });

  it.each([
    ["missing", { error: Object.assign(new Error("nope"), { code: "ENOENT" }) }],
    ["timed out", { error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }), status: null }],
    ["failing", { status: 1, stdout: "" }],
  ])("returns null when lsof is %s", (_n, result) => {
    expect(liveProcesses({ platform: "darwin", run: () => result, uid: 1 })).toBeNull();
  });

  it("keeps every lane with the platform reason when the lister fails", async () => {
    const git = async (args) => (args[0] === "worktree"
      ? { stdout: "worktree /r/.kj/worktrees/a\nbranch refs/heads/a\n" }
      : { stdout: "" });
    const processes = liveProcesses({ platform: "darwin", run: () => ({ status: 1, stdout: "" }), uid: 1 });
    const lanes = await classifyLanes({ git, laneRoot: "/r/.kj/worktrees", base: "main", processes });
    expect(lanes[0].reasons).toContain("cannot check for live processes on this platform");
  });

  it("a lane with no process in it is removable when lsof works", async () => {
    const git = async (args) => (args[0] === "worktree"
      ? { stdout: "worktree /r/.kj/worktrees/a\nbranch refs/heads/a\n" }
      : { stdout: "" });
    const processes = liveProcesses({ platform: "darwin", run: () => ({ status: 0, stdout: LSOF }), uid: 1 });
    const lanes = await classifyLanes({ git, laneRoot: "/r/.kj/worktrees", base: "main", processes });
    expect(lanes[0].reasons).toEqual([]);
  });
});
