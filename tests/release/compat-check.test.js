import { describe, expect, it } from "vitest";
import { compatCheck, exitCodeOf } from "../../src/release/compat-check.js";

function fakeRun({ failTest = false } = {}) {
  const calls = [];
  const run = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    if (cmd === "git" && args[0] === "rev-parse") return { code: 0, stdout: "main\n" };
    if (cmd === "git" && args[0] === "rev-list") return { code: 0, stdout: "0\n" };
    if (cmd === "npm" && args[0] === "test" && failTest) return { code: 1, stdout: "" };
    return { code: 0, stdout: "" };
  };
  return { calls, run };
}

describe("compatCheck", () => {
  it.each([[null, 0], [{ code: 2 }, 2], [{ code: "ENOENT" }, 1], [{ code: null, signal: "SIGTERM" }, 1]])("maps the execFile error %j to exit code %i", (error, code) => {
    expect(exitCodeOf(error)).toBe(code);
  });

  it("removes the temporary worktree even when the suite fails", async () => {
    const { calls, run } = fakeRun({ failTest: true });
    const res = await compatCheck({ projectDir: "/p", candidate: "abc", run });
    expect(res).toEqual({ suite: "fail", lane: "none" });
    const adds = calls.filter((c) => c.args[0] === "worktree" && c.args[1] === "add");
    const removes = calls.filter((c) => c.args[0] === "worktree" && c.args[1] === "remove");
    expect(adds).toHaveLength(1);
    expect(removes).toHaveLength(1);
  });

  it("only fetches and adds or removes worktrees on the user's tree", async () => {
    const { calls, run } = fakeRun();
    await compatCheck({ projectDir: "/p", candidate: "abc", run });
    const onUserTree = calls.filter((c) => c.cmd === "git" && c.cwd === "/p").map((c) => c.args[0]);
    const allowed = new Set(["fetch", "worktree", "rev-parse", "rev-list"]);
    expect(onUserTree.every((a) => allowed.has(a))).toBe(true);
  });
});
