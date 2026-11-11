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

  // KJC-BUG-0362 (#2199): PR 1 merged, PR 2 committed but not pushed yet: no open
  // PR exists to carry the card, so its own push was blocked.
  it("carries on the current branch of the same card with unmerged commits that is not the merged one", () => {
    const local = { name: "fix/KJC-BUG-0197-part-2", unique: 2 };
    const res = call({ localBranch: local, mergedHeads: { 1802: "fix/KJC-BUG-0197-part-1" } });
    expect(res.blocking).toEqual([]);
    expect(res.carried).toEqual([{ card: "KJC-BUG-0197", why: "sigue entregándose en la rama fix/KJC-BUG-0197-part-2, con 2 commit(s) sin mergear" }]);
  });

  it("still blocks the merged branch itself, a branch with nothing unmerged, another card's branch, or an unknown merged head", () => {
    const merged = { 1802: "fix/KJC-BUG-0197-part-1" };
    expect(call({ localBranch: { name: "fix/KJC-BUG-0197-part-1", unique: 3 }, mergedHeads: merged }).blocking).toHaveLength(1);
    expect(call({ localBranch: { name: "fix/KJC-BUG-0197-part-2", unique: 0 }, mergedHeads: merged }).blocking).toHaveLength(1);
    expect(call({ localBranch: { name: "fix/KJC-BUG-0300-x", unique: 2 }, mergedHeads: merged }).blocking).toHaveLength(1);
    expect(call({ localBranch: { name: "fix/KJC-BUG-0197-part-2", unique: 2 }, mergedHeads: {} }).blocking).toHaveLength(1);
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

  it("asks git and gh for the current branch, its unmerged commits and the merged PR's head", () => {
    const answers = {
      "pr list": "[]",
      "rev-parse --abbrev-ref HEAD": "fix/KJC-BUG-0197-part-2\n",
      "symbolic-ref --short refs/remotes/origin/HEAD": "origin/main\n",
      "rev-list --count origin/main..HEAD": "2\n",
      "pr view 1802": JSON.stringify({ headRefName: "fix/KJC-BUG-0197-part-1" }),
    };
    const run = (cmd, args) => {
      const key = Object.keys(answers).find((k) => args.join(" ").startsWith(k));
      if (!key) throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
      return answers[key];
    };
    expect(boardGate({ sessionId: "s1", deps: { readState: () => state, run } }).blocking).toEqual([]);
  });

  // KJC-BUG-0363 (#2201): the hook runs BEFORE the command's own gh auth switch,
  // and other sessions move the active account: gh pr list as the wrong account
  // answered 404, and the block said nothing of why. It still blocks, and says so.
  it("when gh cannot list the open PRs it blocks and names the account switch as the way out", () => {
    const res = gate(null);
    expect(res.blocking).toHaveLength(1);
    expect(res.reason).toMatch(/cuenta activa.*gh auth switch --user <cuenta>.*corre antes que el comando/);
  });

  // KJC-BUG-0548 (#3880): the HU's owner moved it to done from their own session, so no call
  // of this session ever cleared the pending and the Stop gate held the turn for good.
  describe("a shared-board HU already done elsewhere", () => {
    const issue = (state, labels) => JSON.stringify({ state, labels: labels.map((name) => ({ name })) });
    const runWith = (issueJson) => (cmd, args) => {
      if (args[0] === "issue") return issueJson;
      if (args.join(" ").startsWith("pr list")) return "[]";
      throw new Error("not needed");
    };
    const st = () => ({ sessions: { s1: { pending_moves: [P("HU-3827", 3828), P("KJC-BUG-0197")] } } });
    it("is resolved and pruned from the state; the rest still decides as before", () => {
      const pruned = [];
      const res = boardGate({ sessionId: "s1", deps: { readState: st, run: runWith(issue("CLOSED", ["kj:hu", "kj:done"])), prune: (sid, cards) => pruned.push([sid, cards]) } });
      expect(res.resolved).toEqual([{ card: "HU-3827", why: "ya está en done en el board compartido" }]);
      expect(res.blocking.map((p) => p.card)).toEqual(["KJC-BUG-0197"]);
      expect(pruned).toEqual([["s1", ["HU-3827"]]]);
    });
    it("stays blocking when the issue is open, closed without kj:done, or gh cannot read it", () => {
      for (const run of [runWith(issue("OPEN", ["kj:done"])), runWith(issue("CLOSED", ["kj:hu"])), runWith("not json")]) {
        const res = boardGate({ sessionId: "s1", deps: { readState: st, run, prune: () => { throw new Error("must not prune"); } } });
        expect(res.blocking.map((p) => p.card)).toEqual(["HU-3827", "KJC-BUG-0197"]);
      }
    });
  });

  // KJC-BUG-0554 (HU-3937): a merged teammate's HU is theirs to move; kj itself refuses the move.
  describe("a shared-board HU closed and held by another person", () => {
    const issue = (state, assignees, labels = ["kj:hu"]) => JSON.stringify({ state, labels: labels.map((name) => ({ name })), assignees: assignees.map((login) => ({ login })) });
    const runWith = (issueJson) => (cmd, args) => {
      if (args[0] === "issue") {
        if (issueJson instanceof Error) throw issueJson;
        return issueJson;
      }
      if (args.join(" ").startsWith("pr list")) return "[]";
      throw new Error("not needed");
    };
    const st = () => ({ sessions: { s1: { pending_moves: [P("HU-3897", 3903)] } } });
    const gateFor = (run, me = "manufosela", prune = () => {}) =>
      boardGate({ sessionId: "s1", deps: { readState: st, run, prune, readIdentity: () => (me ? { gh_user: me } : null) } });

    it("stops blocking, is reported in heldElsewhere and pruned", () => {
      const pruned = [];
      const res = gateFor(runWith(issue("CLOSED", ["jorgecasar"])), "manufosela", (sid, cards) => pruned.push([sid, cards]));
      expect(res.blocking).toEqual([]);
      expect(res.heldElsewhere).toEqual([{ card: "HU-3897", holder: "jorgecasar", why: "la mueve su titular (jorgecasar)" }]);
      expect(pruned).toEqual([["s1", ["HU-3897"]]]);
    });

    it("stays blocking on any doubt", () => {
      const must = () => { throw new Error("must not prune"); };
      const cases = [
        [runWith(issue("CLOSED", [])), "manufosela"],
        [runWith(issue("CLOSED", ["manufosela"])), "manufosela"],
        [runWith(issue("CLOSED", ["jorgecasar", "manufosela"])), "manufosela"],
        [runWith(issue("CLOSED", ["jorgecasar"])), null],
        [runWith(issue("OPEN", ["jorgecasar"])), "manufosela"],
        [runWith(new Error("gh failed")), "manufosela"],
      ];
      for (const [run, me] of cases) {
        const res = gateFor(run, me, must);
        expect(res.blocking.map((p) => p.card)).toEqual(["HU-3897"]);
        expect(res.heldElsewhere).toBeUndefined();
      }
    });

    it("closed with kj:done is resolved, not held", () => {
      const res = gateFor(runWith(issue("CLOSED", ["jorgecasar"], ["kj:done"])));
      expect(res.resolved.map((r) => r.card)).toEqual(["HU-3897"]);
      expect(res.heldElsewhere).toBeUndefined();
    });
  });

  it("decides nothing without state, session or pendings", () => {
    for (const st of [null, {}, { sessions: { s1: {} } }, { sessions: { s1: { pending_moves: [] } } }]) {
      expect(gate([], st)).toEqual({ blocking: [], carried: [] });
    }
  });
});
