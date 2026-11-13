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
});
