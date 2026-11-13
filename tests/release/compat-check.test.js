import { describe, expect, it, vi } from "vitest";
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
    expect(res).toMatchObject({ suite: "fail", lane: "none" });
    const adds = calls.filter((c) => c.args[0] === "worktree" && c.args[1] === "add");
    const removes = calls.filter((c) => c.args[0] === "worktree" && c.args[1] === "remove");
    expect(adds).toHaveLength(1);
    expect(removes).toHaveLength(1);
  });

  it("installs with npm ci and no --ignore-scripts, and a passing run has no detail", async () => {
    const { calls, run } = fakeRun();
    const res = await compatCheck({ projectDir: "/p", candidate: "abc", run });
    const install = calls.find((c) => c.cmd === "npm" && c.args[0] === "ci");
    expect(install.args).toEqual(["ci"]);
    expect(res).toEqual({ suite: "pass", lane: "none" });
  });

  it("keeps the last 20 lines of a failing test step as detail", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    const run = async (cmd, args) => (cmd === "npm" && args[0] === "test" ? { code: 1, stdout: lines, stderr: "boom\n" } : { code: 0, stdout: "0\n" });
    const res = await compatCheck({ projectDir: "/p", candidate: "abc", run });
    const detail = res.detail.split("\n");
    expect(detail).toHaveLength(20);
    expect(detail.at(-1)).toBe("boom");
    expect(detail[0]).toBe("line 12");
  });

  it("only fetches and adds or removes worktrees on the user's tree", async () => {
    const { calls, run } = fakeRun();
    await compatCheck({ projectDir: "/p", candidate: "abc", run });
    const onUserTree = calls.filter((c) => c.cmd === "git" && c.cwd === "/p").map((c) => c.args[0]);
    const allowed = new Set(["fetch", "worktree", "rev-parse", "rev-list"]);
    expect(onUserTree.every((a) => allowed.has(a))).toBe(true);
  });
});

describe("compatCheck progress", () => {
  const laneRun = async (cmd, args) => {
    if (cmd === "git" && args[0] === "rev-parse") return { code: 0, stdout: "feat/lane\n" };
    if (cmd === "git" && args[0] === "rev-list") return { code: 0, stdout: "1\n" };
    return { code: 0, stdout: "" };
  };

  it("announces every step in order with its result", async () => {
    const { run } = fakeRun();
    const lines = [];
    await compatCheck({ projectDir: "/p", candidate: "abc", run, progress: (l) => lines.push(l) });
    expect(lines).toEqual([
      "release check: installing the candidate abc (npm ci)…",
      "release check: installing the candidate abc (npm ci)… passed",
      "release check: running the candidate's suite (several minutes)…",
      "release check: running the candidate's suite… passed",
    ]);
  });

  it("announces the lane's rebase and suite after the candidate's", async () => {
    const lines = [];
    await compatCheck({ projectDir: "/p", candidate: "abc", run: laneRun, progress: (l) => lines.push(l) });
    expect(lines.slice(4)).toEqual([
      "release check: rebasing your lane onto the candidate…",
      "release check: rebasing your lane onto the candidate… passed",
      "release check: installing your lane (npm ci)…",
      "release check: installing your lane (npm ci)… passed",
      "release check: running your lane's suite (several minutes)…",
      "release check: running your lane's suite… passed",
    ]);
  });

  it("beats every 30 s while a step runs, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    try {
      let finishTest;
      const gate = new Promise((resolve) => { finishTest = resolve; });
      const slowTest = async (cmd, args) => {
        if (cmd === "npm" && args[0] === "test") await gate;
        return { code: 0, stdout: "", stderr: "" };
      };
      const lines = [];
      const pending = compatCheck({ projectDir: "/p", candidate: "abc", run: slowTest, progress: (l) => lines.push(l) });
      await vi.waitFor(() => expect(lines).toContain("release check: running the candidate's suite (several minutes)…"));
      await vi.advanceTimersByTimeAsync(65_000);
      finishTest();
      await pending;
      expect(lines).toContain("release check: still running the candidate's suite (30 s)…");
      expect(lines).toContain("release check: still running the candidate's suite (1 min)…");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
