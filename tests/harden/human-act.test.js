// KJC-TSK-0951: the layers of a human act (ADR 0009), on their own. The seal's
// tests (supervisor-commit.test.js) keep proving them through `harden --commit`;
// these prove the module any other human-only command builds on.
import { describe, it, expect } from "vitest";
import { HUMAN_ACTS, agentAncestry, confirmHuman, humanAct, humanActOf, refuseAgentSession } from "../../src/harden/human-act.js";

// KJC-TSK-0966 (HUM-C, ADR 0018): one closed catalog, one mechanism.
describe("the catalog of human acts", () => {
  const human = { env: {}, tty: true, ancestry: { readProc: () => ({ ppid: 1, cmd: "bash" }) } };

  it("an id outside the catalog is refused by name", () => {
    expect(() => humanActOf("delete-everything")).toThrow(/not in the catalog of human acts/);
  });

  it("humanAct runs the four layers for a catalog id, with the act's own label", () => {
    expect(() => humanAct("rules-approve", { ...human, confirm: (nonce) => nonce })).not.toThrow();
    expect(() => humanAct("rules-approve", { ...human, env: { CLAUDECODE: "1" }, confirm: (nonce) => nonce })).toThrow(/kj rules approve es un acto humano/);
    expect(() => humanAct("supervisor-seal", { ...human, confirm: () => "wrong" })).toThrow(/harden --commit: confirmación humana fallida/);
  });

  it("every act names a module or the card that will bring it", () => {
    for (const act of Object.values(HUMAN_ACTS)) expect(Boolean(act.module) || /^KJC-TSK-\d{4}$/.test(act.pending)).toBe(true);
  });
});

const chain = (cmds) => (pid) => cmds[pid] ?? { ppid: 1, cmd: "init" };
const HUMAN = { env: {}, tty: true, ancestry: { pid: 100, readProc: chain({ 100: { ppid: 50, cmd: "node kj" }, 50: { ppid: 1, cmd: "bash" } }) } };

describe("refuseAgentSession", () => {
  it("lets a human terminal through", () => {
    expect(() => refuseAgentSession("kj x", HUMAN)).not.toThrow();
  });

  it("names the act when the environment or the terminal says agent", () => {
    for (const over of [{ env: { CLAUDECODE: "1" } }, { env: { KJ_NON_INTERACTIVE: "1" } }, { tty: false }]) {
      expect(() => refuseAgentSession("kj x", { ...HUMAN, ...over })).toThrow(/^kj x es un acto humano/);
    }
  });

  it("a clean environment and a fake pty do not hide the ancestry", () => {
    const ancestry = { pid: 200, readProc: chain({ 200: { ppid: 150, cmd: "node kj" }, 150: { ppid: 1, cmd: "claude --session" } }) };
    expect(agentAncestry(ancestry)).toMatchObject({ agent: true });
    expect(() => refuseAgentSession("kj x", { ...HUMAN, ancestry })).toThrow(/desciende de un agente \(claude/);
  });
});

describe("confirmHuman", () => {
  it("passes only when the nonce comes back as shown, a fresh one each time", () => {
    const seen = [];
    confirmHuman("kj x", (nonce) => { seen.push(nonce); return nonce; });
    confirmHuman("kj x", (nonce) => { seen.push(nonce); return nonce; });
    expect(seen[0]).toMatch(/^[0-9a-f]{6}$/);
    expect(seen[0]).not.toBe(seen[1]);
    for (const answer of ["yes", "", null]) {
      expect(() => confirmHuman("kj x", () => answer)).toThrow(/^kj x: confirmación humana fallida/);
    }
  });
});
