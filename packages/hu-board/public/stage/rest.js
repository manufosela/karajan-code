// KJC-TSK-1398 (ADR 0046): the stage at rest shows the last real state of each
// piece (from /api/stage/state): its light, and a line a screen reader can read.
import { boardLine, mergeCards, withCard } from './cards.js';
import { launchedLabel } from './models.js';

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
      // KJC-BUG-0581: a session works in one lane; its start in another takes it out of the first.
      const moved = (w) => event.phase === 'start' && event.id && w.id === event.id;
      const others = (state.working ?? []).filter((w) => !same(w) && !moved(w));
      // KJC-TSK-1536: and the model and effort it was launched with, when its start said them.
      const launched = Object.fromEntries(['model', 'effort'].filter((k) => event[k]).map((k) => [k, event[k]]));
      // KJC-BUG-0577: a teammate's keeps whose it is and its avatar.
      const whose = event.owner ? { owner: event.owner, avatar: event.avatar ?? { emblem: null, color: null } } : {};
      const now = { agent: event.agent, role: event.role, lane, at: event.at, skills: event.skills ?? [], id: event.id ?? null, tool: event.tool ?? null, kind: event.kind ?? null, ...launched, ...whose };
      // KJC-TSK-1607: a host whose turn ends waiting (KJC-TSK-1606) is still there, waiting.
      const waits = event.phase === 'end' && event.role === 'host' && event.waits;
      const working = event.phase === 'start' ? [...others, now] : [...others, ...(waits ? [{ ...now, waiting: waits }] : [])];
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


// KJC-TSK-1524: kj review's checks, in the order of the pieces' row.
const CHECKED = [['tdd', 'TDD'], ['sonar', 'SonarQube'], ['steward', 'Steward']];

/** The light and the line of each piece kj review last checked. */
function checkStates(given, now) {
  const checks = given ?? {};
  const done = CHECKED.filter(([piece]) => checks[piece]);
  const passed = (piece) => checks[piece].outcome === 'pass';
  return {
    lights: Object.fromEntries(done.map(([piece]) => [piece, passed(piece) ? PASSED : REFUSED])),
    entries: done.map(([piece, name]) => entry(`${name}: ${passed(piece) ? 'passed' : 'refused'}, ${ago(checks[piece].at, now)}`, checks[piece].at, passed(piece) ? 'pass' : 'refuse')),
  };
}

/** KJC-TSK-1608: a line of the status, when it happened (null: it is now, or has no time) and its tone. */
const entry = (text, at, tone) => ({ text, at: at ? Date.parse(at) : null, tone });

/**
 * KJC-TSK-1608 (the maintainer, 2026-11-13): the status reads top down: who works now, then what
 * happened from the newest down, the newest marked, then what has no time (the board's count).
 */
export function statusOrder(entries) {
  const live = entries.filter((e) => e.tone === 'live' || (e.tone === 'wait' && e.at === null));
  const timed = entries.filter((e) => e.at !== null).toSorted((a, b) => b.at - a.at);
  const rest = entries.filter((e) => e.at === null && !live.includes(e));
  return [...live, ...timed.map((e, i) => (i === 0 ? { ...e, newest: true } : e)), ...rest];
}

// KJC-TSK-1430: who is at work right now, as the robots on the floor show it.
const usingOf = (w) => (w.skills?.length ? ['with', w.skills.join(', ')] : []);
const whereOf = (w) => (w.lane && w.lane !== 'main' ? ['in', w.lane] : []);
// KJC-TSK-1435: the host says the tool it uses; a subagent, its type.
function whatOf(w) {
  // KJC-TSK-1607: a host that waits says for what.
  if (w.role === 'host' && w.waiting) return [w.waiting === 'person' ? 'waits for you' : 'waits for a process'];
  if (w.role === 'host') return w.tool ? ['working', `(${w.tool})`] : ['working'];
  if (w.role === 'subagent') return ['subagent', ...(w.kind ? [w.kind] : [])];
  return [DOING[w.role] ?? w.role];
}
// KJC-TSK-1536: the model and effort it runs with, when known: "claude coding (Opus 5.5, high)".
const doingOf = (w) => [w.agent, ...whatOf(w), ...whereOf(w), ...usingOf(w), launchedLabel(w)].filter(Boolean).join(' ');

/** KJC-TSK-1608: who works now, which leads the list; it waits when a host waits for the person. */
const workingEntry = (working) => entry(`At work: ${working.map(doingOf).join(', ')}`, null, working.some((w) => w.waiting === 'person') ? 'wait' : 'live');

const tone = (good) => (good ? 'pass' : 'refuse');

/** The lights and lines of the Sentinel, the review, the Ledger and the Git gates, as far as each is known. */
function pieceStates({ denial, verdict, seal, gate }, now) {
  const lights = {};
  const entries = [];
  if (denial) {
    if (now - Date.parse(denial.at) < RECENT_MS) lights.sentinel = REFUSED;
    entries.push(entry(`Sentinel: last denial ${ago(denial.at, now)} (${denial.tool})`, denial.at, 'refuse'));
  }
  if (verdict) {
    const approved = verdict.verdict === 'approved';
    lights.review = approved ? PASSED : REFUSED;
    entries.push(entry(`Review: ${verdict.verdict} by ${verdict.reviewer ?? 'an unnamed reviewer'}, ${ago(verdict.at, now)}`, verdict.at, tone(approved)));
  }
  if (seal) {
    const allowed = seal.decision !== 'deny';
    lights.ledger = allowed ? PASSED : REFUSED;
    entries.push(entry(`Ledger: ${seal.decision} at ${seal.chokepoint}, ${ago(seal.at, now)}`, seal.at, tone(allowed)));
  }
  // KJC-TSK-1427: the commit-msg guard's last attempt opens the Git gates or keeps them shut.
  if (gate) {
    lights.gates = gate.outcome === 'pass' ? PASSED : REFUSED;
    entries.push(entry(gateLine(gate, now), gate.at, tone(gate.outcome === 'pass')));
  }
  return { lights, entries };
}

export function restState(state, now) {
  const { rag, reindex, checks } = state;
  const working = state.working ?? [];
  const pieces = pieceStates(state, now);
  const checked = checkStates(checks, now);
  // KJC-TSK-1608: each line with when it happened and its tone, for statusOrder.
  const entries = [...pieces.entries, ...checked.entries];
  if (rag) entries.push(entry(ragLine(rag, now), rag.at, 'info'));
  if (reindex) entries.push(entry(reindexLine(reindex, now), reindex.at, 'info'));
  const board = boardLine(state.cards ?? []); // KJC-TSK-1458: the factory's task board, counted
  if (board) entries.push(entry(board, null, 'info'));
  if (working.length) entries.push(workingEntry(working));
  return { lights: { ...checked.lights, ...pieces.lights }, lines: entries.map((e) => e.text), ordered: statusOrder(entries) };
}
