// KJC-TSK-1398 (ADR 0046): the stage at rest shows the last real state of each
// piece (from /api/stage/state): its light, and a line a screen reader can read.
import { boardLine, mergeCards, withCard } from './cards.js';

/** A denial older than this no longer lights the Sentinel. */
const RECENT_MS = 15 * 60 * 1000;
const REFUSED = { gold: 0, red: 0.35 };
const PASSED = { gold: 1, red: 0 };

const ago = (at, now) => {
  const min = Math.floor((now - Date.parse(at)) / 60000);
  return min < 1 ? 'just now' : `${min} min ago`;
};

const newest = (records) => records.filter(Boolean).toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;

/**
 * KJC-TSK-1433 (ADR 0048): one last state from the state of every lane: the
 * newest of each record, and everyone at work, each with its lane.
 */
export function acrossLanes(lanes) {
  const pick = (key) => newest(lanes.map((l) => l[key]));
  const working = lanes.flatMap((l) => (l.working ?? []).map((w) => ({ ...w, lane: l.lane })));
  // KJC-TSK-1458 (ADR 0050): one board for the factory, a card that went through lanes at its newest.
  const cards = mergeCards(lanes.map((l) => l.cards ?? []));
  // KJC-TSK-1524: each piece kj review checks at its newest check of any lane.
  const pieces = new Set(lanes.flatMap((l) => Object.keys(l.checks ?? {})));
  const checks = Object.fromEntries([...pieces].map((p) => [p, newest(lanes.map((l) => l.checks?.[p]))]));
  // KJC-TSK-1525: the last release, which only the main checkout's state carries.
  const release = pick('release');
  return { denial: pick('denial'), verdict: pick('verdict'), seal: pick('seal'), gate: pick('gate'), checks, release, working, cards, lanes };
}

/** The last real state after a live event (KJC-TSK-1399): only the piece it touches moves. */
export function withEvent(state, event) {
  switch (event?.type) {
    case 'sentinel-deny': return { ...state, denial: { at: event.at, tool: event.tool } };
    case 'review-verdict': return { ...state, verdict: { verdict: event.verdict, reviewer: event.reviewer, at: event.at } };
    case 'ledger-seal': return { ...state, seal: { decision: event.decision, chokepoint: event.chokepoint, at: event.at } };
    case 'commit-gate': return { ...state, gate: { outcome: event.outcome, rule: event.rule, at: event.at } };
    case 'agent-activity': {
      const lane = event.lane ?? 'main';
      // KJC-TSK-1435: the host's session and each subagent are told apart by their id.
      const same = (w) => (w.lane ?? 'main') === lane && (event.id ? w.id === event.id : w.agent === event.agent && w.role === event.role);
      const others = (state.working ?? []).filter((w) => !same(w));
      const now = { agent: event.agent, role: event.role, lane, at: event.at, skills: event.skills ?? [], id: event.id ?? null, tool: event.tool ?? null, kind: event.kind ?? null };
      const working = event.phase === 'start' ? [...others, now] : others;
      return { ...state, working };
    }
    // KJC-TSK-1438: the RAG answered a lane; kaRAGan takes it there.
    case 'rag-answer': return { ...state, rag: { sources: event.sources, lane: event.lane ?? 'main', at: event.at } };
    // KJC-TSK-1522: the RAG starts or ends a reindex of a lane; kaRAGan types there meanwhile.
    case 'rag-index': return { ...state, reindex: { phase: event.phase, lane: event.lane ?? 'main', at: event.at } };
    // KJC-TSK-1524: kj review checked TDD, Sonar or the Steward.
    case 'method-check': return { ...state, checks: { ...state.checks, [event.piece]: { outcome: event.outcome, at: event.at } } };
    // KJC-TSK-1458 (ADR 0050): a card pinned or moved; a queued move changes nothing yet.
    case 'card': {
      const cards = withCard(state.cards ?? [], event);
      return cards === state.cards ? state : { ...state, cards };
    }
    default: return state;
  }
}

const DOING = { coder: 'coding', reviewer: 'reviewing', solomon: 'arbitrating' };

/** KJC-TSK-1427: the commit-msg guard's last attempt, as the status list tells it. */
function gateLine(gate, now) {
  const told = gate.outcome === 'pass' ? 'commit passed' : `commit refused (${gate.rule})`;
  return `Git gates: ${told}, ${ago(gate.at, now)}`;
}

/** KJC-TSK-1438: what kaRAGan last took to a lane. */
function ragLine(rag, now) {
  const where = rag.lane && rag.lane !== 'main' ? ` in ${rag.lane}` : '';
  const sources = `${rag.sources} source${rag.sources === 1 ? '' : 's'}`;
  return `kaRAGan: answered with ${sources}${where}, ${ago(rag.at, now)}`;
}

/** KJC-TSK-1522: the reindex kaRAGan is at, or the last one it did. */
function reindexLine({ phase, lane, at }, now) {
  const where = lane && lane !== 'main' ? ` in ${lane}` : '';
  return phase === 'start' ? `kaRAGan: reindexing${where}, since ${ago(at, now)}` : `kaRAGan: reindexed${where}, ${ago(at, now)}`;
}

/** What kaRAGan last answered and the reindex it is at, as far as each is known. */
const kaRAGanLines = (rag, reindex, now) => [rag && ragLine(rag, now), reindex && reindexLine(reindex, now)].filter(Boolean);

// KJC-TSK-1524: kj review's checks, in the order of the pieces' row.
const CHECKED = [['tdd', 'TDD'], ['sonar', 'SonarQube'], ['steward', 'Steward']];

/** The light and the line of each piece kj review last checked. */
function checkStates(given, now) {
  const checks = given ?? {};
  const done = CHECKED.filter(([piece]) => checks[piece]);
  const passed = (piece) => checks[piece].outcome === 'pass';
  return {
    lights: Object.fromEntries(done.map(([piece]) => [piece, passed(piece) ? PASSED : REFUSED])),
    lines: done.map(([piece, name]) => `${name}: ${passed(piece) ? 'passed' : 'refused'}, ${ago(checks[piece].at, now)}`),
  };
}

export function restState(state, now) {
  const { denial, verdict, seal, gate, rag, reindex, checks } = state;
  const working = state.working ?? [];
  const cards = state.cards ?? [];
  const checked = checkStates(checks, now);
  const lights = { ...checked.lights };
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
    lines.push(gateLine(gate, now));
  }
  lines.push(...checked.lines, ...kaRAGanLines(rag, reindex, now));
  const board = boardLine(cards); // KJC-TSK-1458: the factory's task board, counted
  if (board) lines.push(board);
  // KJC-TSK-1430: who is at work right now, as the robots on the floor show it.
  const using = (w) => (w.skills?.length ? ['with', w.skills.join(', ')] : []);
  const where = (w) => (w.lane && w.lane !== 'main' ? ['in', w.lane] : []);
  // KJC-TSK-1435: the host says the tool it uses; a subagent, its type.
  const what = (w) => {
    if (w.role === 'host') return w.tool ? ['working', `(${w.tool})`] : ['working'];
    if (w.role === 'subagent') return ['subagent', ...(w.kind ? [w.kind] : [])];
    return [DOING[w.role] ?? w.role];
  };
  const doing = (w) => [w.agent, ...what(w), ...where(w), ...using(w)].join(' ');
  if (working.length) lines.push(`At work: ${working.map(doing).join(', ')}`);
  return { lights, lines };
}
