/**
 * HU-3335 (epic #3332, ADR 0029): GitHub Issues as a task manager of the story contract.
 * It wraps createHu/listHus/setStatus/claim of github-board.js; the issue number behind
 * HU-<n> (or #<n>) is this adapter's business, the core hands over the id as it got it.
 * `board` lets a caller swap any of those functions (tests, offline fakes).
 */
import { createHu, adoptHu, listHus, setStatus, claim, assertNotHeld } from "./github-board.js";

const ISSUE_ID = /^(?:HU-|#)(\d+)$/i;
const SHARED_ID = /^(?:HU-|#)[1-9]\d*$/i;

export function createGithubManager({ repo, run, board = {} }) {
  const fn = { createHu, adoptHu, listHus, setStatus, claim, assertNotHeld, ...Object.fromEntries(Object.entries(board).filter(([, f]) => f)) };
  const base = run ? { repo, run } : { repo };
  const idHint = "HU-<issue number>";
  const numberOf = (id) => {
    const number = Number(ISSUE_ID.exec(id)?.[1]);
    if (!Number.isInteger(number)) throw new Error(`"${id}" is not a shared-board HU: use ${idHint}`);
    return number;
  };
  const find = async (id) => (await fn.listHus(base)).find((h) => h.number === numberOf(id));
  // The writes alone: a failed read-back must never fail a write that went through.
  const write = {
    move: (id, status) => fn.setStatus({ ...base, number: numberOf(id), status }),
    claim: (id, who, { release = false } = {}) => fn.claim({ ...base, number: numberOf(id), who, release }),
  };
  return {
    idHint,
    // ADR 0029: criteria live in the issue body, issues only link to one another, the verdicts go on the PR.
    capabilities: { acceptanceCriteria: "body", dependencies: "partial", assignee: true, verdicts: "pr", offline: true, tier: true },
    credentials: [], // gh holds the login
    // Zero-padded (HU-0NNN) is a card of the local board, never an issue.
    isId: (ref) => SHARED_ID.test(ref),
    canonicalId: (ref) => `HU-${numberOf(ref)}`,
    write,
    list: () => fn.listHus(base),
    create: async (args) => ({ claimed_by: null, ref: args.ref ?? null, ...(await fn.createHu({ ...base, ...args })) }),
    adopt: (number) => fn.adoptHu({ ...base, number }),
    move: async (id, status) => { await write.move(id, status); return find(id); },
    claim: async (id, who, opts) => { await write.claim(id, who, opts); return find(id); },
    /** Not part of the contract: a running HU held by someone else is theirs (the core decides what to do). */
    assertNotHeld: (id, who) => fn.assertNotHeld({ ...base, number: numberOf(id), who }),
  };
}
