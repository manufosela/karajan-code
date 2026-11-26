// HU-4930 (KJC-TSK-1808): a thread whose first comment has no author (a deleted account) still counts.
import { describe, expect, it } from "vitest";
import { unresolvedThreadProblems } from "../../src/review/review-threads.js";

describe("unresolvedThreadProblems with no author (HU-4930)", () => {
  it("names a thread with no author login as someone's", async () => {
    const thread = { isResolved: false, isOutdated: false, path: "src/a.js", line: 4, author: null };
    const run = async () => ({ exitCode: 0, stdout: JSON.stringify(thread) });
    const problems = await unresolvedThreadProblems({ projectDir: "/p", pr: 7, author: "alice", run });
    expect(problems).toEqual(["src/a.js:4 has an unresolved review thread by someone: resolve it on the PR"]);
  });
});
