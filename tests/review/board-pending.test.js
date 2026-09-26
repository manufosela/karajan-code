// KJC-BUG-0198: board-sync asumia una PR por card y la regla del repo dice lo
// contrario. Con KJC-BUG-0197 (#1802 y #1803) mergear la primera exigia mover
// la card, lo que habria sido mentira: tres KJ_ALLOW_BOARD=1, y ese escape apaga
// el gate ENTERO. El TURNO sigue sin poder acabar con trabajo sin registrar.
import { describe, expect, it } from "vitest";

import { blockingMoves, boardGate } from "../../src/review/board-pending.js";

const P = (card, pr = 1802) => ({ card, pr });
const call = (over) => blockingMoves({ pendings: [P("KJC-BUG-0197")], openPrHeads: [], ...over });

describe("blockingMoves", () => {
  it("carries a pending whose card has another OPEN pr", () => {
    const res = call({ openPrHeads: ["fix/KJC-BUG-0197-verify"] });
    expect(res.blocking).toEqual([]);
    expect(res.carried).toEqual([{ card: "KJC-BUG-0197", why: "sigue entregándose en una PR abierta" }]);
  });

  it("does NOT carry on the branch name: the merged branch carries that name too", () => {
    // Aceptarlo perdonaria todo merge hecho desde el carril de su propia card.
    expect(call({ openPrHeads: [] }).blocking).toHaveLength(1);
  });

  it("blocks when the card is not being delivered anywhere", () => {
    expect(call({ openPrHeads: ["fix/KJC-BUG-0300-x"] }).blocking).toEqual([P("KJC-BUG-0197")]);
  });

  it("blocks a pending with no card, one that would forgive itself, and a near-miss id", () => {
    // Sin card no hay nada contra lo que comprobar.
    expect(call({ pendings: [P(null)], openPrHeads: ["fix/KJC-BUG-0197-x"] }).blocking).toHaveLength(1);
    // Una PR mergeada no esta abierta; si una lista sucia la trae, no se perdona sola.
    expect(call({ openPrHeads: ["fix/KJC-BUG-0197-x"], openPrNumbers: [1802] }).blocking).toHaveLength(1);
    // 0019 no es 00190, y la comparacion ignora mayusculas.
    expect(call({ pendings: [P("KJC-BUG-0019")], openPrHeads: ["fix/kjc-bug-00190-otra"] }).blocking).toHaveLength(1);
    expect(call({ pendings: [P("kjc-bug-0197")], openPrHeads: ["fix/KJC-BUG-0197-x"] }).blocking).toEqual([]);
  });

  it("fails closed when the open prs could not be read, and keeps cards apart", () => {
    const blind = call({ openPrHeads: null });
    expect(blind.blocking).toHaveLength(1);
    expect(blind.reason).toMatch(/no se pudo comprobar/);
    const mixed = call({ pendings: [P("KJC-BUG-0197"), P("KJC-BUG-0205", 1804)], openPrHeads: ["fix/KJC-BUG-0197-verify"] });
    expect(mixed.blocking.map((p) => p.card)).toEqual(["KJC-BUG-0205"]);
  });

  it("decides nothing without pendings", () => {
    expect(blockingMoves({ pendings: [], openPrHeads: [] })).toEqual({ blocking: [], carried: [] });
  });
});

describe("boardGate", () => {
  const state = { sessions: { s1: { pending_moves: [P("KJC-BUG-0197")] } } };
  const runner = (prs) => () => {
    if (prs === null) throw new Error("gh: not found");
    return JSON.stringify(prs);
  };
  const gate = (prs, st = state) => boardGate({ sessionId: "s1", deps: { readState: () => st, run: runner(prs) } });

  it("reads the session's pendings and decides with gh's answer", () => {
    expect(gate([{ number: 1803, headRefName: "fix/KJC-BUG-0197-verify" }]).blocking).toEqual([]);
    expect(gate([{ number: 1900, headRefName: "fix/KJC-BUG-0300-x" }]).blocking).toHaveLength(1);
    expect(gate(null).reason).toMatch(/no se pudo comprobar/);
  });

  it("decides nothing without state, session or pendings", () => {
    for (const st of [null, {}, { sessions: { s1: {} } }, { sessions: { s1: { pending_moves: [] } } }]) {
      expect(gate([], st)).toEqual({ blocking: [], carried: [] });
    }
  });
});
