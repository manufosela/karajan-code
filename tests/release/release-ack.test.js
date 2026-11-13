import { describe, expect, it } from "vitest";
import { releaseAckCommand } from "../../src/commands/release-ack.js";
import { parseAnswer } from "../../src/release/answers.js";
import { RELEASE_BLOCK } from "../../src/release/proposal.js";

const proposal = { version: "1.2.3", candidate: "abcdef1234567", base: "v1.2.2", deadline: "2026-11-13T12:00:00.000Z", participants: ["ana"] };
const issueBody = `Proposed\n\n${RELEASE_BLOCK(proposal)}\n`;

function setup(check = { suite: "pass", lane: "none" }) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    return args.includes("--method") ? "https://github.com/o/r/issues/7#issuecomment-1\n" : JSON.stringify({ body: issueBody });
  };
  const printed = [];
  const base = { repo: "o/r", issue: 7, projectDir: "/p", gh, check: async () => check, print: (l) => printed.push(l) };
  return { calls, printed, base };
}

describe("releaseAckCommand", () => {
  it.each([
    [{ issue: 0, decision: "ok" }, "0"],
    [{ decision: "maybe" }, "maybe"],
    [{ decision: "hold" }, "why"],
    [{ decision: "include", include: [] }, "PR"],
    [{ decision: "include", include: [12, Number("nope")] }, "Not a PR number (--include): NaN"],
    [{ decision: "include", include: [0, -3] }, "Not a PR number (--include): 0, -3"],
    [{ decision: "ok", include: [1.5] }, "Not a PR number (--include): 1.5"],
  ])("refuses %j", async (extra, named) => {
    const { base, calls } = setup();
    await expect(releaseAckCommand({ ...base, ...extra })).rejects.toThrow(named);
    expect(calls).toEqual([]);
  });

  it("posts one comment whose block carries decision, why, include, candidate and check", async () => {
    const { base, calls, printed } = setup({ suite: "pass", lane: "fail" });
    const res = await releaseAckCommand({ ...base, decision: "include", include: [12], why: "mine too" });
    const post = calls.filter((a) => a.includes("--method"));
    expect(post).toHaveLength(1);
    expect(post[0]).toContain("repos/o/r/issues/7/comments");
    const answer = parseAnswer(post[0].find((a) => a.startsWith("body=")).slice(5));
    expect(answer).toMatchObject({ decision: "include", why: "mine too", include: [12], candidate: proposal.candidate, check: { suite: "pass", lane: "fail" } });
    expect(printed[0]).toContain("issuecomment-1");
    expect(res.exitCode).toBe(0);
  });

  it("ok with a failing check posts it and exits 1 explaining the hold", async () => {
    const { base, printed } = setup({ suite: "fail", lane: "none" });
    const res = await releaseAckCommand({ ...base, decision: "ok" });
    expect(res.exitCode).toBe(1);
    expect(printed.join("\n")).toMatch(/counts as a hold/);
  });
});
