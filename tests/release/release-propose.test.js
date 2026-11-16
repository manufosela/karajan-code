import { describe, it, expect, vi } from "vitest";
import { releaseProposeCommand } from "../../src/commands/release-propose.js";

const git = (args) => (args[0] === "describe" ? "v5.21.0\n" : "abcdef1234567\n");
const commit = { sha: "1111111", message: "feat: a\n\nbody", login: "ana", name: "Ana", parents: 1 };
const makeGh = () => vi.fn(async (args) => {
  if (args.includes("POST")) return "https://github.com/o/r/issues/9\n";
  return args[2].includes("/compare/") ? `${JSON.stringify(commit)}\n` : "";
});

describe("releaseProposeCommand", () => {
  it.each(["5.22", "v5.22.0"])("refuses %s", async (version) => {
    await expect(releaseProposeCommand({ repo: "o/r", version, gh: makeGh(), git })).rejects.toThrow(version);
  });
  it("posts once with the release label and a deadline 4 h after now", async () => {
    const gh = makeGh();
    const print = vi.fn();
    const res = await releaseProposeCommand({ repo: "o/r", version: "5.22.0", now: Date.UTC(2026, 10, 13, 12), gh, git, print });
    const posts = gh.mock.calls.filter(([a]) => a.includes("POST"));
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toContain("labels[]=release");
    expect(posts[0][0]).toContain("title=Release 5.22.0");
    expect(res).toEqual({ url: "https://github.com/o/r/issues/9", deadline: "2026-11-13T16:00:00.000Z" });
    expect(print).toHaveBeenCalledWith(res.url);
  });

  // KJC-BUG-0615 (HU-4422): run from a lane, propose took the lane's HEAD, a fix without its PR,
  // as the candidate, and that candidate lacked the release's own version bump.
  it("proposes the remote base branch it fetches, never the local HEAD, and says when they differ", async () => {
    const calls = [];
    const laneGit = (args) => {
      calls.push(args.join(" "));
      if (args[0] === "describe") return "v5.21.0\n";
      if (args[0] === "rev-parse") return args[1] === "origin/main" ? "main0000000000\n" : "lane1111111111\n";
      return "";
    };
    const gh = makeGh();
    const print = vi.fn();
    await releaseProposeCommand({ repo: "o/r", version: "5.22.0", base: "main", gh, git: laneGit, print });
    expect(calls).toContain("fetch -q origin +refs/heads/main:refs/remotes/origin/main");
    expect(gh.mock.calls.find(([a]) => a[2].includes("/compare/"))[0][2]).toContain("v5.21.0...main0000000000");
    expect(gh.mock.calls.find(([a]) => a.includes("POST"))[0].join(" ")).toContain("main000");
    expect(print.mock.calls.flat().join("\n")).toMatch(/HEAD .*lane111.* is not origin\/main/);
  });

  it("without --base it proposes the project's configured base branch", async () => {
    const calls = [];
    const devGit = (args) => { calls.push(args.join(" ")); return args[0] === "describe" ? "v5.21.0\n" : "dev0000000000\n"; };
    await releaseProposeCommand({ repo: "o/r", version: "5.22.0", gh: makeGh(), git: devGit, print: vi.fn(), resolveBase: async () => "develop" });
    expect(calls).toContain("fetch -q origin +refs/heads/develop:refs/remotes/origin/develop");
    expect(calls).toContain("rev-parse origin/develop");
  });
});
