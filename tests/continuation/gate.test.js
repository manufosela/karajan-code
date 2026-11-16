// KJC-TSK-1651 (ADR 0059): the turn does not end while the session's cards wait, unless the stop is one kj can check.
import { describe, expect, it } from "vitest";
import { judgeStop, runningBackground, sessionCards } from "../../src/continuation/gate.js";

const out = (text) => ({ kind: "output", text });
const user = (text) => ({ kind: "user", text });

describe("sessionCards", () => {
  it("follows the cards the session created and moved, to their last status", () => {
    const texts = [
      out("✓ HU created: HU-10 (pending) in the shared board, issue #10"),
      out("✓ HU created: HU-11 (pending) in the shared board, issue #11"),
      out("✓ HU-10 → running"),
      out("✓ HU-10 → done"),
      out("✓ HU-12 → running"),
    ];
    expect(sessionCards(texts)).toEqual(new Map([["HU-10", "done"], ["HU-11", "pending"], ["HU-12", "running"]]));
  });
  it("leaves out cards the session only read", () => {
    expect(sessionCards([out("HU-20 pending - someone else's card")])).toEqual(new Map());
  });
});

describe("runningBackground", () => {
  it("names the background tasks started without their completion notice", () => {
    const texts = [
      out("Command running in background with ID: aaa111. Output is being written to: /x"),
      out("Command running in background with ID: bbb222. Output is being written to: /y"),
      user("<task-notification>\n<task-id>aaa111</task-id>\n<status>completed</status>"),
    ];
    expect(runningBackground(texts)).toEqual(["bbb222"]);
  });
});

describe("judgeStop", () => {
  const cards = new Map([["HU-1", "done"], ["HU-2", "pending"]]);
  const base = { cards, handoffsOpen: false, background: [] };
  it("lets the turn end when none of the session's cards is pending or running", () => {
    expect(judgeStop({ ...base, cards: new Map([["HU-1", "done"]]), text: "All done." })).toEqual({ hold: false });
  });
  it("holds a turn that stops with cards left and no stated reason, naming the next card", () => {
    const verdict = judgeStop({ ...base, text: "Llevamos mucho rato, seguimos mañana." });
    expect(verdict).toMatchObject({ hold: true, next: "HU-2" });
    expect(verdict.reason).toMatch(/HU-2.*Me paro por/s);
  });
  it("holds a stated reason kj cannot check", () => {
    expect(judgeStop({ ...base, text: "Hecho HU-1.\n\nMe paro por llevar mucho tiempo." })).toMatchObject({ hold: true, next: "HU-2" });
  });
  it.each([
    ["an open handoff", { handoffsOpen: true }, "Me paro por esperar tu sello."],
    ["a question that closes the message", {}, "¿Hacemos la HU-2 con la opción A?\n\nMe paro por esperar tu respuesta."],
    ["a background task still running", { background: ["bbb222"] }, "Stopping because the CI is still running."],
  ])("lets a stated stop end the turn with %s", (_name, extra, text) => {
    expect(judgeStop({ ...base, ...extra, text })).toEqual({ hold: false });
  });
  it("does not take a checkable fact without a stated stop", () => {
    expect(judgeStop({ ...base, handoffsOpen: true, text: "Hecho." })).toMatchObject({ hold: true });
  });
});
