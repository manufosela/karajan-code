import { describe, expect, it } from "vitest";
import { renderAnswer } from "../../src/release/answers.js";
import { RELEASE_BLOCK } from "../../src/release/proposal.js";
import { releaseApproveCommand } from "../../src/commands/release-approve.js";

const block = { version: "1.0.1", candidate: "abc1234", base: "v1.0.0", deadline: "2026-11-13T12:00:00.000Z", participants: ["ana", "bob"] };
const ack = (login, decision, why = "") => JSON.stringify({ login, body: renderAnswer({ candidate: "abc1234", decision, why, include: [], check: { suite: "pass", lane: "none" } }) });
const hold = ack("ana", "hold", "flaky suite");
const AFTER = Date.parse("2026-11-13T13:00:00Z");
const BEFORE = Date.parse("2026-11-13T10:00:00Z");

/** The issue holds `acks` and `block`, read at `now`; `later` replaces any of them once the phone has signed. */
function run({ later = {}, signature = { signer: "k" }, ...initial } = {}) {
  const calls = [];
  const issueNow = () => ({ acks: [ack("ana", "ok"), ack("bob", "ok")], block, now: AFTER, ...initial, ...(calls.some(([kind]) => kind === "act") ? later : {}) });
  const gh = async (args) => {
    if (args.includes("--paginate")) return `${issueNow().acks.join("\n")}\n`;
    if (args.includes("POST")) { calls.push(["post", args.at(-3)]); return "https://gh/c/1\n"; }
    return JSON.stringify({ body: `Proposed\n\n${RELEASE_BLOCK(issueNow().block)}\n` });
  };
  const git = async (args) => { calls.push(["git", ...args]); return ""; };
  const act = async (files) => { calls.push(["act", files[0].file]); return signature; };
  return { promise: releaseApproveCommand({ repo: "o/r", issue: 7, clock: () => issueNow().now, gh, git, act, print: () => {} }), calls };
}

describe("kj release approve", () => {
  it.each([
    ["ready", {}],
    ["past the deadline by the time it posts, an answer withdrawn while the phone signs counts as no objection", { now: BEFORE, later: { acks: [ack("ana", "ok")], now: AFTER } }],
  ])("%s: signs once, posts the approval, tags the candidate and pushes the tag, in that order", async (_, options) => {
    const { promise, calls } = run(options);
    await expect(promise).resolves.toMatchObject({ url: "https://gh/c/1", tag: "v1.0.1" });
    expect(calls).toEqual([
      ["act", "release-approval/o/r@1.0.1"], ["post", expect.stringMatching(/kj-release-approval/)],
      ["git", "tag", "v1.0.1", "abc1234"], ["git", "push", "origin", "v1.0.1"],
    ]);
  });

  it.each([
    ["a release with a hold, naming who holds and why", { acks: [hold, ack("bob", "ok")] }, /@ana: hold \(flaky suite\)/, []],
    ["a release with someone silent before the deadline, naming them and it", { acks: [ack("ana", "ok")], now: BEFORE }, /@bob.*2026-11-13T12:00:00.000Z/, []],
    ["a candidate that is not a commit sha", { block: { ...block, candidate: "--force" } }, /not a commit sha/, []],
    ["an approval no phone signed", { signature: null }, /signature/, ["act"]],
    ["a hold that lands while the phone signs", { later: { acks: [hold, ack("bob", "ok")] } }, /no longer ready[\s\S]*@ana: hold \(flaky suite\)/, ["act"]],
    ["a proposal moved to another candidate while the phone signs", { later: { block: { ...block, candidate: "def5678" } } }, /changed while you signed/, ["act"]],
    ["a proposal moved to another version while the phone signs", { later: { block: { ...block, version: "1.0.2" } } }, /changed while you signed/, ["act"]],
  ])("refuses %s: nothing is posted nor tagged", async (_, options, error, calledFirst) => {
    const { promise, calls } = run(options);
    await expect(promise).rejects.toThrow(error);
    expect(calls.map(([kind]) => kind)).toEqual(calledFirst);
  });
});
