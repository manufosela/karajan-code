import { describe, expect, it } from "vitest";
import { participantsOf, readReleaseInputs } from "../../src/release/participants.js";

const commit = (sha, login, name = login, parents = 1) => ({ sha, subject: `s${sha}`, login, name, parents });
const pr = (number, author) => ({ number, title: `t${number}`, author, headRefName: `b${number}`, isDraft: number % 2 === 0 });

describe("participantsOf", () => {
  it("groups commits by author in order and drops merge commits", () => {
    const { goingOut } = participantsOf({ commits: [commit("1", "bob"), commit("2", "ann"), commit("m", "bob", "bob", 2), commit("3", "bob")], prs: [] });
    expect(goingOut).toEqual([
      { who: "bob", login: "bob", commits: [{ sha: "1", subject: "s1" }, { sha: "3", subject: "s3" }] },
      { who: "ann", login: "ann", commits: [{ sha: "2", subject: "s2" }] },
    ]);
  });

  it("lists an author with no login by name but does not ask them", () => {
    const result = participantsOf({ commits: [commit("1", null, "Ghost")], prs: [] });
    expect(result.goingOut).toEqual([{ who: "Ghost", login: null, commits: [{ sha: "1", subject: "s1" }] }]);
    expect(result.participants).toEqual([]);
  });

  it("keeps bots out of the participants", () => {
    const result = participantsOf({ commits: [commit("1", "dependabot[bot]")], prs: [pr(1, "renovate[bot]")] });
    expect(result.goingOut).toHaveLength(1);
    expect(result.participants).toEqual([]);
  });

  it("counts a PR author once, with two PRs or also a commit author", () => {
    const result = participantsOf({ commits: [commit("1", "zed")], prs: [pr(1, "zed"), pr(2, "zed"), pr(3, "amy")] });
    expect(result.stayingOut).toEqual([
      { who: "zed", login: "zed", prs: [{ number: 1, title: "t1", draft: false }, { number: 2, title: "t2", draft: true }] },
      { who: "amy", login: "amy", prs: [{ number: 3, title: "t3", draft: false }] },
    ]);
    expect(result.participants).toEqual(["amy", "zed"]);
  });
});

// What gh api --paginate --jq prints: one object per line, from every page.
const lines = (items) => items.map((item) => `${JSON.stringify(item)}\n`).join("");
const apiCommit = (sha, login, parents = 1) => ({ sha, message: `subject ${sha}\n\nbody`, login, name: `Name ${sha}`, parents });
const apiPr = (number, author) => ({ number, title: `wip ${number}`, author, headRefName: `feat/${number}`, isDraft: true });

const fakes = ({ tag = "v1.0.0", commits = [], prs = [apiPr(7, "amy")] }) => {
  const calls = [];
  const git = (args) => {
    if (args[0] === "describe") { if (!tag) throw new Error("fatal: No names found"); return `${tag}\n`; }
    return "abc123\n";
  };
  const gh = async (args) => {
    calls.push(args);
    return lines(args[2].includes("/compare/") ? commits : prs);
  };
  return { git, gh, calls };
};

describe("readReleaseInputs", () => {
  it("reads every page of the commits since the tag and of the open PRs, only the fields it needs", async () => {
    const { git, gh, calls } = fakes({ commits: [apiCommit("a", "bob"), apiCommit("b", null, 2)] });
    const inputs = await readReleaseInputs({ repo: "o/r", gh, git });
    expect(calls).toEqual([
      ["api", "--paginate", "repos/o/r/compare/v1.0.0...abc123?per_page=100", "--jq",
        ".commits[] | {sha, message: .commit.message, login: .author.login, name: .commit.author.name, parents: (.parents | length)}"],
      ["api", "--paginate", "repos/o/r/pulls?state=open&per_page=100", "--jq",
        ".[] | {number, title, author: .user.login, headRefName: .head.ref, isDraft: .draft}"],
    ]);
    expect(inputs).toEqual({
      tag: "v1.0.0", head: "abc123",
      commits: [
        { sha: "a", subject: "subject a", login: "bob", name: "Name a", parents: 1 },
        { sha: "b", subject: "subject b", login: null, name: "Name b", parents: 2 },
      ],
      prs: [{ number: 7, title: "wip 7", author: "amy", headRefName: "feat/7", isDraft: true }],
    });
  });

  it("keeps every commit and every open PR past the old caps of 250 and 200", async () => {
    const commits = Array.from({ length: 251 }, (_, i) => apiCommit(`c${i}`, `dev${i}`));
    const prs = Array.from({ length: 201 }, (_, i) => apiPr(i + 1, `owner${i}`));
    const { git, gh } = fakes({ commits, prs });
    const inputs = await readReleaseInputs({ repo: "o/r", gh, git });
    expect([inputs.commits.length, inputs.prs.length]).toEqual([251, 201]);
    expect(inputs.prs.at(-1)).toEqual(prs.at(-1));
  });

  it("reads no PRs from an empty answer", async () => {
    const { git, gh } = fakes({ prs: [] });
    expect((await readReleaseInputs({ repo: "o/r", gh, git })).prs).toEqual([]);
  });

  it.each(["o/r?state=closed", "../r", "o", "o/r/pulls"])("refuses %j, not an owner/name repo, before asking GitHub", async (repo) => {
    const { git, gh, calls } = fakes({});
    await expect(readReleaseInputs({ repo, gh, git })).rejects.toThrow(/owner\/name/);
    expect(calls).toEqual([]);
  });

  it("fails loudly when the repo has no tag", async () => {
    const { git, gh } = fakes({ tag: null, commits: [] });
    await expect(readReleaseInputs({ repo: "o/r", gh, git })).rejects.toThrow(/no tag/i);
  });
});
