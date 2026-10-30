// KJC-TSK-1313: which card each worktree lane works on, read from git (never stored on the card).
import { describe, expect, it } from "vitest";
import { parseLanes, lanesByCard } from "../../src/hu/lanes.js";

const PORCELAIN = [
  "worktree /repo", "HEAD aaa", "branch refs/heads/main", "",
  "worktree /repo/.kj/worktrees/KJC-TSK-1313-lanes", "HEAD bbb", "branch refs/heads/feat/KJC-TSK-1313-lanes", "",
  "worktree /repo/.kj/worktrees/detached", "HEAD ccc", "detached", "",
  "worktree /elsewhere/fix-hu-27", "HEAD ddd", "branch refs/heads/fix/HU-27-typo", "",
].join("\n");

describe("parseLanes", () => {
  it("lists the worktrees with a branch, leaving out the main checkout and detached ones", () => {
    expect(parseLanes(PORCELAIN)).toEqual([
      { slug: "KJC-TSK-1313-lanes", branch: "feat/KJC-TSK-1313-lanes", path: "/repo/.kj/worktrees/KJC-TSK-1313-lanes" },
      { slug: "fix-hu-27", branch: "fix/HU-27-typo", path: "/elsewhere/fix-hu-27" },
    ]);
  });

  it("keeps only the lanes under a root when one is given", () => {
    expect(parseLanes(PORCELAIN, { root: "/repo/.kj/worktrees" }).map((l) => l.slug)).toEqual(["KJC-TSK-1313-lanes"]);
  });

  it("an empty listing has no lanes", () => {
    expect(parseLanes("")).toEqual([]);
  });
});

describe("lanesByCard", () => {
  const lanes = parseLanes(PORCELAIN);

  it("matches a card whose id is a whole token of the lane's branch, case-insensitively", () => {
    const map = lanesByCard(lanes, ["KJC-TSK-1313", "hu-27"]);
    expect(map.get("KJC-TSK-1313").map((l) => l.slug)).toEqual(["KJC-TSK-1313-lanes"]);
    expect(map.get("hu-27").map((l) => l.slug)).toEqual(["fix-hu-27"]);
  });

  it("never matches a prefix of a longer id, and a card with no lane has no entry", () => {
    const map = lanesByCard(lanes, ["KJC-TSK-131", "HU-2", "KJC-TSK-9999"]);
    expect([...map.keys()]).toEqual([]);
  });

  it("an id with regex characters is matched literally", () => {
    expect([...lanesByCard([{ slug: "x", branch: "feat/a.b", path: "/x" }], ["a+b", "a.b"]).keys()]).toEqual(["a.b"]);
  });
});
