import { describe, expect, it } from "vitest";
import { renderAnswer } from "../../src/release/answers.js";
import { RELEASE_BLOCK } from "../../src/release/proposal.js";
import { releaseStatusCommand } from "../../src/commands/release-status.js";

const block = { version: "1.0.1", candidate: "abc1234", base: "v1.0.0", deadline: "2026-11-13T12:00:00.000Z", participants: ["ana", "bob"] };
const answer = (decision, why) => renderAnswer({ candidate: "abc1234", decision, why, include: [], check: { suite: "pass", lane: "none" } });
const ack = (login, decision, why = "") => JSON.stringify({ login, body: answer(decision, why), createdAt: "2026-11-13T09:00:00Z" });
const ghWith = (acks) => async (args) => (args.includes("--paginate")
  ? `${acks.join("\n")}\n`
  : JSON.stringify({ body: `Proposed\n\n${RELEASE_BLOCK(block)}\n` }));
const run = async (issue, now, acks = [ack("ana", "ok")]) => {
  const lines = [];
  const result = await releaseStatusCommand({ repo: "o/r", issue, now, gh: ghWith(acks), print: (l) => lines.push(l) });
  return { result, lines };
};

describe("kj release status", () => {
  it("prints who confirmed, who is silent and what it waits for", async () => {
    const { result, lines } = await run(7, Date.parse("2026-11-13T10:00:00Z"));
    expect(result.ready).toBe(false);
    expect(lines).toEqual(["@ana: confirmed", "@bob: silent", "Not ready: waiting for @bob until 2026-11-13T12:00:00.000Z."]);
  });
  it("is ready once the deadline passed", async () => {
    const { result, lines } = await run(7, Date.parse("2026-11-13T13:00:00Z"));
    expect(result.ready).toBe(true);
    expect(lines.at(-1)).toBe("Ready: the release can go out.");
  });
  it("prints each hold with its reason, if any, and waits for it even past the deadline", async () => {
    const { result, lines } = await run(7, Date.parse("2026-11-13T13:00:00Z"), [ack("ana", "hold", "flaky suite"), ack("bob", "include")]);
    expect(result.ready).toBe(false);
    expect(lines).toEqual(["@ana: hold (flaky suite)", "@bob: include", "Not ready: waiting for @ana, @bob to lift the hold."]);
  });
  it("refuses an issue that is not a positive integer", async () => {
    await expect(run(0, 1)).rejects.toThrow(/issue number/);
    await expect(run(Number("abc"), 1)).rejects.toThrow(/issue number/);
  });
});
