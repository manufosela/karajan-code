// HU-4930 (KJC-TSK-1808, point 1 of #4891): a finding left as a line comment, with no request for
// changes, did not stop the merge either. verify-pr now fails while the PR has an unresolved review
// thread that is not outdated and was opened by someone other than the PR's author (the person's
// decision, 26-nov): another AI, a bot or a person.
import { describe, expect, it } from "vitest";
import { unresolvedThreadProblems } from "../../src/review/review-threads.js";

const thread = (over = {}) => ({ isResolved: false, isOutdated: false, path: "src/a.js", line: 12, author: "bob", ...over });

function fakeGh(threads, calls = []) {
  return async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === "gh" && args[0] === "api" && args[1] === "graphql") return { exitCode: 0, stdout: threads.map((t) => JSON.stringify(t)).join("\n") };
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
}

describe("unresolvedThreadProblems (HU-4930)", () => {
  it("names the file, the line and the author of an unresolved thread", async () => {
    const problems = await unresolvedThreadProblems({ projectDir: "/p", pr: 7, author: "alice", run: fakeGh([thread()]) });
    expect(problems).toEqual(["src/a.js:12 has an unresolved review thread by bob: resolve it on the PR"]);
  });

  it("a thread on the whole file has no line", async () => {
    const problems = await unresolvedThreadProblems({ projectDir: "/p", pr: 7, author: "alice", run: fakeGh([thread({ line: null })]) });
    expect(problems).toEqual(["src/a.js has an unresolved review thread by bob: resolve it on the PR"]);
  });

  it("resolved threads, outdated ones and the PR author's own do not count", async () => {
    const threads = [thread({ isResolved: true }), thread({ isOutdated: true }), thread({ author: "alice" })];
    expect(await unresolvedThreadProblems({ projectDir: "/p", pr: 7, author: "alice", run: fakeGh(threads) })).toEqual([]);
  });

  it("counts only a thread GitHub says is unresolved and not outdated, never a line it cannot read as one", async () => {
    const lines = [{ body: "a review", user: { login: "x" } }, thread({ isResolved: undefined }), thread({ isOutdated: null })];
    expect(await unresolvedThreadProblems({ projectDir: "/p", pr: 7, author: "alice", run: fakeGh(lines) })).toEqual([]);
  });

  it("asks GraphQL for every page of the PR's threads, in the repo of the checkout", async () => {
    const calls = [];
    await unresolvedThreadProblems({ projectDir: "/p", pr: 7, author: "alice", run: fakeGh([], calls) });
    const [, args] = calls[0];
    expect(args.slice(0, 3)).toEqual(["api", "graphql", "--paginate"]);
    expect(args).toEqual(expect.arrayContaining(["-F", "owner={owner}", "-F", "name={repo}", "-F", "number=7"]));
    const query = args[args.indexOf("-f") + 1];
    expect(query).toMatch(/reviewThreads\(first: *100, *after: *\$endCursor\)/);
    expect(query).toMatch(/isResolved/);
    expect(query).toMatch(/isOutdated/);
    expect(query).toMatch(/pageInfo/);
  });

  it("fails loudly when GitHub cannot answer", async () => {
    const run = async () => ({ exitCode: 1, stdout: "", stderr: "HTTP 502" });
    await expect(unresolvedThreadProblems({ projectDir: "/p", pr: 7, author: "alice", run })).rejects.toThrow(/review threads.*HTTP 502/);
  });
});
