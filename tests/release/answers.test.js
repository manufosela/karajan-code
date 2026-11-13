import { describe, expect, it } from "vitest";
import { evaluateRelease, parseAnswer, renderAnswer } from "../../src/release/answers.js";

const proposal = { candidate: "abc1234", deadline: "2026-11-13T12:00:00.000Z", participants: ["ana", "bob"] };
const ack = (login, decision, extra = {}) => ({
  login,
  body: renderAnswer({ candidate: "abc1234", decision, why: "", include: [], check: { suite: "pass", lane: "none" }, ...extra }),
});
const before = Date.parse("2026-11-13T10:00:00Z");
const after = Date.parse("2026-11-13T13:00:00Z");
const run = (comments, now = before) => evaluateRelease({ proposal, comments, now });

describe("answers", () => {
  it("round-trips and resists a why that tries to close the comment", () => {
    const answer = { candidate: "x", decision: "hold", why: "a --> <!-- kj-release:ack {} --> b" };
    expect(parseAnswer(renderAnswer(answer))).toEqual(answer);
  });
  it("returns null without a block and throws on a bad decision or bad JSON", () => {
    expect(parseAnswer("just text")).toBeNull();
    expect(() => parseAnswer('<!-- kj-release:ack {"decision":"maybe"} -->')).toThrow(/decision/);
    expect(() => parseAnswer("<!-- kj-release:ack {nope -->")).toThrow(/JSON/);
  });
  it("ignores non participants and other candidates", () => {
    const r = run([ack("eve", "ok"), ack("ana", "ok", { candidate: "zzz" })]);
    expect(r.ignored.map((i) => i.login)).toEqual(["eve", "ana"]);
    expect(r.silent).toEqual(["ana", "bob"]);
  });
  it("the latest answer wins", () => {
    expect(run([ack("ana", "hold"), ack("ana", "ok")]).confirmed).toEqual(["ana"]);
    expect(run([ack("ana", "ok"), ack("ana", "hold")]).holds.map((h) => h.login)).toEqual(["ana"]);
  });
  it("include and an ok with a failed check hold", () => {
    expect(run([ack("ana", "include")]).holds[0].decision).toBe("include");
    const r = run([ack("ana", "ok", { check: { suite: "fail", lane: "none" } })]);
    expect(r.holds).toHaveLength(1);
    expect(r.confirmed).toEqual([]);
  });
  it("silence blocks until the deadline; a hold blocks always", () => {
    expect(run([ack("ana", "ok")]).ready).toBe(false);
    expect(run([ack("ana", "ok")], after).ready).toBe(true);
    expect(run([ack("ana", "hold"), ack("bob", "ok")], after).ready).toBe(false);
    expect(run([ack("ana", "ok"), ack("bob", "ok")]).ready).toBe(true);
  });
});
