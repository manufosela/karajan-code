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
    default: return state;
  }
}

export function restState({ denial, verdict, seal }, now) {
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
  return { lights, lines };
}
