// KJC-TSK-1398 (ADR 0046): the stage at rest shows the last real state of each
// piece (from /api/stage/state): its light, and a line a screen reader can read.

/** A denial older than this no longer lights the Sentinel. */
const RECENT_MS = 15 * 60 * 1000;
const REFUSED = { gold: 0, red: 0.35 };
const PASSED = { gold: 1, red: 0 };

const ago = (at, now) => {
  const min = Math.floor((now - Date.parse(at)) / 60000);
  return min < 1 ? 'just now' : `${min} min ago`;
};

/** The last real state after a live event (KJC-TSK-1399): only the piece it touches moves. */
export function withEvent(state, event) {
  switch (event?.type) {
    case 'sentinel-deny': return { ...state, denial: { at: event.at, tool: event.tool } };
    case 'review-verdict': return { ...state, verdict: { verdict: event.verdict, reviewer: event.reviewer, at: event.at } };
    case 'ledger-seal': return { ...state, seal: { decision: event.decision, chokepoint: event.chokepoint, at: event.at } };
    case 'commit-gate': return { ...state, gate: { outcome: event.outcome, rule: event.rule, at: event.at } };
    case 'agent-activity': {
      const others = (state.working ?? []).filter((w) => w.agent !== event.agent || w.role !== event.role);
      const working = event.phase === 'start' ? [...others, { agent: event.agent, role: event.role, at: event.at }] : others;
      return { ...state, working };
    }
    default: return state;
  }
}

const DOING = { coder: 'coding', reviewer: 'reviewing', solomon: 'arbitrating' };

export function restState({ denial, verdict, seal, gate, working = [] }, now) {
  const lights = {};
  const lines = [];
  if (denial) {
    if (now - Date.parse(denial.at) < RECENT_MS) lights.sentinel = REFUSED;
    lines.push(`Sentinel: last denial ${ago(denial.at, now)} (${denial.tool})`);
  }
  if (verdict) {
    lights.review = verdict.verdict === 'approved' ? PASSED : REFUSED;
    lines.push(`Review: ${verdict.verdict} by ${verdict.reviewer ?? 'an unnamed reviewer'}, ${ago(verdict.at, now)}`);
  }
  if (seal) {
    lights.ledger = seal.decision === 'deny' ? REFUSED : PASSED;
    lines.push(`Ledger: ${seal.decision} at ${seal.chokepoint}, ${ago(seal.at, now)}`);
  }
  // KJC-TSK-1427: the commit-msg guard's last attempt opens the Git gates or keeps them shut.
  if (gate) {
    lights.gates = gate.outcome === 'pass' ? PASSED : REFUSED;
    const told = gate.outcome === 'pass' ? 'commit passed' : `commit refused (${gate.rule})`;
    lines.push(`Git gates: ${told}, ${ago(gate.at, now)}`);
  }
  // KJC-TSK-1430: who is at work right now, as the robots on the floor show it.
  const doing = (w) => [w.agent, DOING[w.role] ?? w.role].join(' ');
  if (working.length) lines.push(`At work: ${working.map(doing).join(', ')}`);
  return { lights, lines };
}
