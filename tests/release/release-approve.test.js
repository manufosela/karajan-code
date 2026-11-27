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
function run({ later = {}, signature = { signer: "k" }, level = "max", approver = "maintainer", ...initial } = {}) {
  const calls = [];
  const printed = [];
  const issueNow = () => ({ acks: [ack("ana", "ok"), ack("bob", "ok")], block, now: AFTER, ...initial, ...(calls.some(([kind]) => kind === "act") ? later : {}) });
  const gh = async (args) => {
    if (args.join(" ") === "api user --jq .login") { if (approver) return `${approver}\n`; throw new Error("gh: not logged in"); }
    if (args.includes("--paginate")) return `${issueNow().acks.join("\n")}\n`;
    if (args.includes("POST")) { calls.push(["post", args.at(-3)]); return "https://gh/c/1\n"; }
    return JSON.stringify({ body: `Proposed\n\n${RELEASE_BLOCK(issueNow().block)}\n` });
  };
  const git = async (args) => { calls.push(["git", ...args]); return ""; };
  const act = async (files) => { calls.push(["act", files[0].file]); return signature; };
  return { promise: releaseApproveCommand({ repo: "o/r", issue: 7, clock: () => issueNow().now, gh, git, act, levelOf: () => level, print: (line) => printed.push(line) }), calls, printed };
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

  // KJC-TSK-1654 (ADR 0060): at critical no phone signs; the approval says the terminal confirmed it.
  it("at critical: posts the approval confirmed at the terminal, then tags and pushes", async () => {
    const { promise, calls } = run({ signature: null, level: "critical" });
    await expect(promise).resolves.toMatchObject({ tag: "v1.0.1" });
    expect(calls.map(([kind]) => kind)).toEqual(["act", "post", "git", "git"]);
    expect(calls[1][1]).toMatch(/confirmed at the maintainer's terminal/);
  });

  // KJC-TSK-1658: the maintainer's approval closes the wait early, and the issue says who had not answered.
  it("closes the wait before the deadline when nobody holds, naming who had not answered", async () => {
    const { promise, calls } = run({ acks: [ack("ana", "ok")], now: BEFORE });
    await expect(promise).resolves.toMatchObject({ tag: "v1.0.1" });
    expect(calls.map(([kind]) => kind)).toEqual(["act", "post", "git", "git"]);
    expect(calls[1][1]).toMatch(/closed the wait before 2026-11-13T12:00:00.000Z: @bob had not answered/);
  });

  // HU-4987: approving is answering, so the approver (case-insensitive) is never named as silent.
  it.each([
    ["names only the others who had not answered", { acks: [], approver: "bob" }, "@ana"],
    ["drops the approver whatever the case of the login", { acks: [], approver: "BOB" }, "@ana"],
  ])("closing the wait early %s", async (_, options, named) => {
    const { promise, calls, printed } = run({ now: BEFORE, ...options });
    await expect(promise).resolves.toMatchObject({ tag: "v1.0.1" });
    expect(calls[1][1]).toContain(`closed the wait before 2026-11-13T12:00:00.000Z: ${named} had not answered.`);
    expect(printed).toContain(`✓ it closed the wait early: ${named} had not answered`);
  });

  it("closing the wait early when the approver cannot be read keeps the list and says so, on the issue and at the terminal", async () => {
    const { promise, calls, printed } = run({ now: BEFORE, acks: [], approver: null });
    await expect(promise).resolves.toMatchObject({ tag: "v1.0.1" });
    expect(calls[1][1]).toContain("closed the wait before 2026-11-13T12:00:00.000Z: @ana, @bob had not answered (kj could not read the approver's login, so the approver may be listed).");
    expect(printed[0]).toBe("⚠ could not read your GitHub login (gh: not logged in): the list of who had not answered may include you");
    expect(printed).toContain("✓ it closed the wait early: @ana, @bob had not answered");
  });

  it("closing the wait early when only the approver was silent names no one", async () => {
    const { promise, calls, printed } = run({ acks: [ack("ana", "ok")], now: BEFORE, approver: "bob" });
    await expect(promise).resolves.toMatchObject({ tag: "v1.0.1" });
    expect(calls[1][1]).toContain("It closed the wait before 2026-11-13T12:00:00.000Z.\n");
    expect(calls[1][1]).not.toMatch(/had not answered/);
    expect(printed).toContain("✓ it closed the wait early");
    expect(printed.join("\n")).not.toMatch(/had not answered/);
  });

  it("past the deadline the approval names nobody as closing the wait early", async () => {
    const { promise, calls } = run({ acks: [ack("ana", "ok")] });
    await promise;
    expect(calls[1][1]).not.toMatch(/closed the wait/);
  });

  it("past the deadline the terminal says nothing of closing the wait early", async () => {
    const { promise, printed } = run({ acks: [ack("ana", "ok")] });
    await promise;
    expect(printed).toEqual(["✓ signed approval of 1.0.1 posted: https://gh/c/1", "✓ tagged abc1234 as v1.0.1 and pushed it"]);
  });

  it.each([
    ["a release with a hold, naming who holds and why", { acks: [hold, ack("bob", "ok")] }, /@ana: hold \(flaky suite\)/, []],
    ["a release held before the deadline, however many are silent", { acks: [hold], now: BEFORE }, /@ana: hold \(flaky suite\)/, []],
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
