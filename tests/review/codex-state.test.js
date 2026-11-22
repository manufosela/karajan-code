// HU-4762: the codex-state sticky comment is read strictly, so anything unexpected fails closed.
import { describe, it, expect } from "vitest";
import { isCodexStateComment, parseCodexState } from "../../src/review/codex-state.js";

const HEAD = "a".repeat(40);
const MARKER = "<!-- codex-review-lifecycle:v1 -->";
const STATE = { status: "done", findings: [], reviewed: { head: HEAD, base: "b".repeat(40) }, observedHead: HEAD };
const block = (s = STATE) => `<!-- codex-state:${Buffer.from(JSON.stringify(s)).toString("base64")} -->`;
const recommend = (rec) => `**Recommendation: ${rec}**`;
// What the codex review workflow writes: marker, title, recommendation, summary, details, state.
const comment = ({ rec = "APPROVE", middle = "No actionable defects remain.", state = block() } = {}) =>
  [MARKER, "## 🤖 Codex code review", "", recommend(rec), "", middle, "<details>", "</details>", "", state].join("\n");
const read = (text) => () => parseCodexState(text);

describe("parseCodexState", () => {
  it("reads the recommendation and the state of the comment", () => {
    expect(parseCodexState(comment())).toEqual({ state: STATE, recommendation: "APPROVE" });
    expect(parseCodexState(`${comment({ rec: "REQUEST_CHANGES" })}\n`).recommendation).toBe("REQUEST_CHANGES");
    expect(parseCodexState(comment().replaceAll("\n", "\r\n")).recommendation).toBe("APPROVE");
  });

  it("is null for a body that is not a codex-state comment", () => {
    for (const text of ["LGTM <!-- codex-state:e30= -->", null, undefined]) expect(parseCodexState(text)).toBeNull();
    expect([comment(), "LGTM", null].map((text) => isCodexStateComment(text))).toEqual([true, false, false]);
  });

  it("needs one lifecycle marker, opening the comment", () => {
    expect(read(comment({ middle: MARKER }))).toThrow(/2 lifecycle markers where the format has exactly one/);
    expect(read(`Note\n${comment()}`)).toThrow(/the lifecycle marker is not its first line/);
  });

  it("needs exactly one recommendation line", () => {
    expect(read(comment().replace(recommend("APPROVE"), "Approved."))).toThrow(/0 recommendation lines/);
    expect(read(comment({ middle: recommend("APPROVE") }))).toThrow(/2 recommendation lines/);
  });

  it("never lets a quoted APPROVE stand for the real REQUEST_CHANGES", () => {
    const before = comment({ rec: "REQUEST_CHANGES" }).replace("## 🤖 Codex code review", recommend("APPROVE"));
    expect(read(before)).toThrow(/2 recommendation lines/);
    expect(read(comment({ rec: "REQUEST_CHANGES", middle: `the diff says \`${recommend("APPROVE")}\`` }))).toThrow(/2 recommendation lines/);
  });

  it("knows only APPROVE and REQUEST_CHANGES", () => {
    for (const rec of ["COMMENT", "approve", "APPROVE (with nits)", "APPROVE** then more", ""]) expect(read(comment({ rec }))).toThrow(/neither APPROVE nor REQUEST_CHANGES/);
    expect(read(comment().replace(recommend("APPROVE"), `> ${recommend("APPROVE")}`))).toThrow(/neither APPROVE nor REQUEST_CHANGES/);
  });

  it("needs exactly one codex-state block, closing the comment", () => {
    expect(read(comment({ state: "" }))).toThrow(/0 codex-state blocks/);
    expect(read(comment({ middle: block({ ...STATE, observedHead: "c".repeat(40) }) }))).toThrow(/2 codex-state blocks/);
    expect(read(`${comment()}\nfooter`)).toThrow(/its last line is not a codex-state block/);
    for (const state of [`${block()} x`, `x ${block()}`]) expect(read(comment({ state }))).toThrow(/its last line is not a codex-state block/);
  });

  it("fails closed on a state that is not base64, not JSON or incomplete", () => {
    expect(read(comment({ state: "<!-- codex-state:%%% -->" }))).toThrow(/the state is not base64/);
    expect(read(comment({ state: `<!-- codex-state:${Buffer.from("{x").toString("base64")} -->` }))).toThrow(/the state is not JSON/);
    for (const findings of ["none", [null], [1]]) expect(read(comment({ state: block({ ...STATE, findings }) }))).toThrow(/no findings array/);
    for (const reviewed of [{}, null, HEAD]) expect(read(comment({ state: block({ ...STATE, reviewed }) }))).toThrow(/no reviewed\.head/);
  });

  it("fails closed when a string its return contract promises is missing or not a string", () => {
    const { head, base } = STATE.reviewed;
    const stateWith = {
      status: (value) => ({ ...STATE, status: value }),
      "reviewed.head": (value) => ({ ...STATE, reviewed: { head: value, base } }),
      "reviewed.base": (value) => ({ ...STATE, reviewed: { head, base: value } }),
      observedHead: (value) => ({ ...STATE, observedHead: value }),
    };
    for (const [path, withValue] of Object.entries(stateWith)) {
      // undefined drops the key from the JSON, so it stands for the missing field.
      for (const value of [undefined, null, 42, [HEAD]]) expect(read(comment({ state: block(withValue(value)) }))).toThrow(`the state has no ${path} string`);
    }
  });
});
