/**
 * KJC-TSK-1405 (ADR 0046): the last real state of each stage piece, so the
 * stage opens on what already happened and nothing is simulated. The shapes
 * are the stream's events (stage-feed.js).
 */
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { MAIN_LANE, listLanes } from './lanes.js';
import { branchFacts } from './lane-branch.js';
import { laneNote } from './lane-note.js';
import { deriveLaneState } from './lane-state.js';
import { boardStatuses, withBoardCache } from './stage-board-cache.js';
import { lastRelease } from './stage-release.js';
import { sessionName, withSessionName } from './session-names.js';
import { pendingMail } from './stage-mail.js';
import { TRACE_DIRS, activityEvent, cardEvent, decisionEvent, denialEvent, gateEvent, methodEvent, verdictEvent } from './stage-feed.js';
// The scene folds the live card events with this same function (ADR 0050).
import { mergeCards, withCard } from '../public/stage/cards.js';
import { laneStatus } from '../public/stage/lane-status.js';

/** A start older than this with no end is a run that died without saying so, not work. */
const STALE_START_MS = 30 * 60 * 1000;

/** The parseable lines of a jsonl as events, oldest first, reading at most its last `tailBytes`. */
function tailRecords(file, toEvent, tailBytes) {
  let size;
  try { size = statSync(file).size; } catch { return []; }
  const length = Math.min(size, tailBytes);
  const buf = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, length, size - length); } finally { closeSync(fd); }
  const lines = buf.toString('utf8').split('\n');
  if (length < size) lines.shift(); // the first line of the tail may be cut
  return lines.map((raw) => raw.trim() && toEvent(raw)).filter(Boolean);
}

/**
 * KJC-BUG-0527: the records of one trace across every trace folder, in time order. The
 * oldest folder goes first so that, at the same instant, the newer location wins.
 */
function traceRecords(root, name, toEvent, tailBytes) {
  const all = TRACE_DIRS.toReversed().flatMap((dir) => tailRecords(join(root, dir, name), toEvent, tailBytes));
  return all.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const lastOf = (records) => records.at(-1) ?? null;
const lastRecord = (file, toEvent, tailBytes) => lastOf(tailRecords(file, toEvent, tailBytes));

/** KJC-TSK-1435: the host beats at least once a minute while it works, so a silent host has stopped sooner. */
const STALE_HOST_MS = 5 * 60 * 1000;

/**
 * KJC-TSK-1430: the agents whose last trace is a recent start, by agent and role;
 * KJC-TSK-1435: by id when the trace names one (the host's session, each subagent).
 */
function agentsAtWork(records, now) {
  const last = new Map();
  for (const ev of records) last.set(ev.id ?? `${ev.agent}:${ev.role}`, ev);
  const fresh = (ev) => now - Date.parse(ev.at) < (ev.role === 'host' ? STALE_HOST_MS : STALE_START_MS);
  return [...last.values()]
    .filter((ev) => ev.phase === 'start' && fresh(ev))
    // KJC-TSK-1536: and the model and effort it was launched with, when its start said them.
    .map(({ agent, role, at, id, tool, kind, model, effort }) => ({ agent, role, at, ...(id ? { id, tool, kind } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}) }));
}

function newestVerdict(dir) {
  let names;
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return null; }
  // kj prunes old verdicts, so a file listed here may be gone a moment later.
  const read = (fn) => { try { return fn(); } catch { return null; } };
  const newest = names
    .map((n) => ({ file: join(dir, n), at: read(() => statSync(join(dir, n)).mtimeMs) }))
    .filter((v) => v.at !== null)
    .toSorted((a, b) => b.at - a.at);
  for (const { file } of newest) {
    const event = verdictEvent(read(() => readFileSync(file, 'utf8')));
    if (event) return event;
  }
  return null;
}

export function lastStageState(projectDir, { tailBytes = 64 * 1024, now = Date.now(), lane = 'main', nameOf = sessionName } = {}) {
  const root = join(projectDir, '.karajan');
  // KJC-TSK-1458 (ADR 0050): the factory's board opens on the last line of each card of the lane.
  const trace = (name, toEvent) => traceRecords(root, name, toEvent, tailBytes);
  // KJC-BUG-0546: a line that names its lane (written from it into the main checkout) keeps it.
  const cards = trace('cards.jsonl', cardEvent).reduce((all, ev) => withCard(all, { lane, ...ev }), []);
  return {
    cards,
    denial: lastOf(trace('denials.jsonl', denialEvent)),
    verdict: newestVerdict(join(root, 'reviews')),
    seal: lastRecord(join(root, 'policy-decisions.jsonl'), decisionEvent, tailBytes),
    gate: lastOf(trace('commit-gate.jsonl', gateEvent)),
    // KJC-TSK-1524: the last check kj review made of each of TDD, Sonar and the Steward.
    checks: Object.fromEntries(trace('method.jsonl', methodEvent).map(({ piece, outcome, at }) => [piece, { outcome, at }])),
    working: agentsAtWork(trace('agent-activity.jsonl', activityEvent), now).map((w) => withSessionName(w, nameOf)),
    mail: pendingMail(projectDir),
  };
}

/**
 * KJC-TSK-1432 (ADR 0048): the last state of every lane, the main checkout first.
 * KJC-BUG-0547: each card checked against the shared board's cache of the main checkout.
 */
export function laneStates(projectDir, { branchOf = branchFacts, readers = {}, ...options } = {}) {
  const statuses = boardStatuses(projectDir);
  const lanes = listLanes(projectDir).map(({ lane, dir }) => {
    const state = lastStageState(dir, { ...options, lane });
    // KJC-TSK-1539: the main checkout has no branch of its own to wait on.
    const branch = lane === MAIN_LANE ? undefined : branchOf(dir);
    // KJC-TSK-1541: and what it waits for, when someone left it a note.
    const note = lane === MAIN_LANE ? null : laneNote(projectDir, lane);
    const cards = withBoardCache(state.cards, statuses);
    // HU-3853: the lane's state, from facts. A reader that is missing or throws leaves its fact unread.
    const readFact = (name) => { try { return readers[name]?.({ lane, dir }) ?? null; } catch { return null; } };
    const facts = { working: state.working, cards, mail: state.mail, openPr: readFact('openPr'), merged: readFact('merged') };
    // HU-4029: how the pipeline of its open pull request stands.
    return { lane, ...state, cards, branch, note, pipeline: lane === MAIN_LANE ? null : readFact('pipeline'), ...deriveLaneState(facts) };
  });
  // KJC-TSK-1525: the release the "Ready to release" table counts from, once, on the main checkout.
  lanes[0] = { ...lanes[0], release: lastRelease(projectDir) };
  // KJC-TSK-1539: a card's lane can be told in another lane's trace, so each lane reads the whole board.
  const cards = mergeCards(lanes.map((l) => l.cards));
  return lanes.map((l) => ({ ...l, status: laneStatus(l, cards) }));
}
