// KJC-TSK-1651 (ADR 0059): the turn does not end while the session's cards wait, unless the stop is one kj can check.
import { describe, expect, it } from "vitest";
import { judgeStop, runningBackground, sessionCards, settleWithBoard } from "../../src/continuation/gate.js";

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
  // KJC-BUG-0680: a test run prints kj's lines from its fixtures; only kj hu speaks for the session.
  const from = (tool, command, text) => ({ ...out(text), tool, command });
  it.each([
    ["a test run", "Bash", "npx vitest run"],
    ["a file read", "Read", undefined],
    ["a word that only ends in kj", "Bash", "okj hu list"],
    ["a test run after an echo of the words", "Bash", "echo 'kj hu ' && npx vitest run"],
    ["a search for the words", "Bash", 'grep -rn "kj hu add" tests'],
    ["another kj command quoting them", "Bash", 'kj rag query "kj hu add"'],
    ["an assignment with no command word", "Bash", "HU=HU-7"],
    ["a test run chained after kj hu", "Bash", "kj hu list && npx vitest run"],
    ["a test run chained before kj hu", "Bash", "npx vitest run; kj hu list"],
    ["a filter reading a file after kj hu", "Bash", "kj hu list && tail -1 tests/fixture.txt"],
    ["a filter fed a file after kj hu", "Bash", "kj hu list && tail -1 < tests/fixture.txt"],
  ])("leaves out the lines printed by %s", (_name, tool, command) => {
    expect(sessionCards([from(tool, command, "✓ HU created: HU-7 (pending)")])).toEqual(new Map());
  });
  it("does not let a test run beside kj hu settle a card of the session", () => {
    const texts = [
      from("Bash", 'kj hu add "x" --ref Y', "✓ HU created: HU-4978 (pending) in the shared board"),
      from("Bash", "kj hu list && npx vitest run", "HU-4978 pending x\n✓ HU-4978 → done"),
    ];
    expect(sessionCards(texts)).toEqual(new Map([["HU-4978", "pending"]]));
  });
  it("takes the lines kj hu prints, also behind a cd, a pipe, an assignment or a path", () => {
    const texts = [
      from("Bash", 'kj hu add "x" --ref Y', "✓ HU created: HU-4978 (pending) in the shared board"),
      from("Bash", "cd lane && kj hu move HU-4978 done 2>&1 | tail -1", "✓ HU-4978 → done"),
      from("Bash", "KARAJAN_HOME=k ~/.local/bin/kj hu add y", "✓ HU created: HU-4979 (pending)"),
      from("Bash", "kj hu add z && kj hu move HU-4980 running 2>&1 | head -n 5", "✓ HU created: HU-4980 (pending)\n✓ HU-4980 → running"),
    ];
    expect(sessionCards(texts)).toEqual(new Map([["HU-4978", "done"], ["HU-4979", "pending"], ["HU-4980", "running"]]));
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

// KJC-BUG-0622 (#4478): the transcript remembers moves the board has since overtaken.
describe("settleWithBoard", () => {
  const cards = new Map([["HU-1", "running"], ["HU-2", "pending"], ["HU-3", "running"], ["HU-4", "pending"]]);
  const board = new Map([
    ["HU-1", { status: "done", claimed_by: null }],
    ["HU-2", { status: "running", claimed_by: "someone" }],
    ["HU-3", { status: "running", claimed_by: "me" }],
  ]);
  it("takes the board's status, drops cards someone else holds and keeps the ones it does not know", () => {
    expect(settleWithBoard(cards, board, "me")).toEqual(new Map([["HU-1", "done"], ["HU-3", "running"], ["HU-4", "pending"]]));
  });
  it("keeps a held card when kj cannot tell who works this clone", () => {
    expect(settleWithBoard(cards, board, null).get("HU-2")).toBe("running");
  });
});
