// KJL-TSK-0157 (ADR 0052): rebuilds a real task of a project as the factory demo,
// from the files kj already writes, with the board's own parsers, so the trace
// holds exactly what kj stage would have shown. Prints the demo as JSON.
//   node record-factory-demo.mjs <projectDir> <HU id> <lane,lane,...>
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRACE_DIRS, activityEvent, cardEvent, decisionEvent, denialEvent, gateEvent, methodEvent, verdictEvent } from '../../../packages/hu-board/src/stage-feed.js';
import { withCard } from '../../../packages/hu-board/public/stage/cards.js';

const TRACES = [['denials.jsonl', denialEvent], ['commit-gate.jsonl', gateEvent], ['agent-activity.jsonl', activityEvent], ['cards.jsonl', cardEvent], ['method.jsonl', methodEvent]];
const PATH = /(?:\/home|\/tmp|\/Users|[A-Z]:\\Users)[^\s'"`)]*/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/** A denial's reason without absolute paths; an email in it stops the recording. */
export function sanitizeWhy(why) {
  if (EMAIL.test(why ?? '')) throw new Error('record-factory-demo: a denial names an email; the demo is not recorded');
  return String(why ?? '').replace(PATH, '…');
}

const read = (file) => { try { return readFileSync(file, 'utf8'); } catch { return null; } };
const rows = (file, toEvent) => (read(file) ?? '').split('\n').filter((l) => l.trim()).map(toEvent).filter(Boolean);
const homeOf = (projectDir, lane) => (lane === 'main' ? projectDir : join(projectDir, '.kj', 'worktrees', lane));

/** Every stage event a lane's files hold, oldest first, tagged with the lane (a card line keeps its own). */
function laneEvents(projectDir, lane) {
  const root = join(homeOf(projectDir, lane), '.karajan');
  const traced = TRACE_DIRS.flatMap((dir) => TRACES.flatMap(([name, toEvent]) => rows(join(root, dir, name), toEvent)));
  const seals = rows(join(root, 'policy-decisions.jsonl'), decisionEvent);
  const reviews = join(root, 'reviews');
  const verdicts = existsSync(reviews) ? readdirSync(reviews).filter((n) => n.endsWith('.json')).map((n) => verdictEvent(read(join(reviews, n)))).filter((e) => e?.at) : [];
  return [...traced, ...seals, ...verdicts].map((e) => ({ lane, ...e }));
}

/** What a lane showed when the task started: the last record of each piece and its cards. */
function stateAt(lane, before) {
  const last = (type) => before.findLast((e) => e.type === type) ?? null;
  const checks = Object.fromEntries(before.filter((e) => e.type === 'method-check').map(({ piece, outcome, at }) => [piece, { outcome, at }]));
  const cards = before.filter((e) => e.type === 'card').reduce((all, e) => withCard(all, e), []);
  return { lane, cards, denial: last('sentinel-deny'), verdict: last('review-verdict'), seal: last('ledger-seal'), gate: last('commit-gate'), checks, working: [], mail: 0 };
}

/** Session ids become session-1, session-2...; reasons lose their paths; the session's own name is dropped. */
function sanitizer() {
  const ids = new Map();
  return (e) => {
    const { name: _name, ...rest } = e;
    if (rest.type === 'agent-activity' && rest.id) rest.id = ids.get(rest.id) ?? ids.set(rest.id, `session-${ids.size + 1}`).get(rest.id);
    if (rest.why !== undefined) rest.why = sanitizeWhy(rest.why);
    return rest;
  };
}

export function recordDemo({ projectDir, task, lanes }) {
  const all = lanes.flatMap((lane) => laneEvents(projectDir, lane))
    .filter((e) => e.type !== 'card' || lanes.includes(e.lane))
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const own = all.filter((e) => e.type === 'card' && e.id === task);
  const from = own.find((e) => e.status === 'running')?.at;
  const to = own.findLast((e) => e.status === 'done')?.at;
  if (!from || !to) throw new Error(`record-factory-demo: ${task} never went from running to done in these lanes`);
  const clean = sanitizer();
  const before = all.filter((e) => e.at < from).map(clean);
  return {
    task,
    title: own.find((e) => e.title)?.title ?? null,
    from,
    to,
    lanes,
    state: { lanes: lanes.map((lane) => stateAt(lane, before.filter((e) => e.lane === lane))) },
    events: all.filter((e) => e.at >= from && e.at <= to).map(clean),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [projectDir, task, lanes] = process.argv.slice(2);
  const demo = recordDemo({ projectDir, task, lanes: lanes.split(',') });
  const { events, ...head } = demo;
  // One event per line, so a change to the demo reads as a diff of events.
  console.log(`${JSON.stringify(head).slice(0, -1)},"events":[\n${events.map((e) => JSON.stringify(e)).join(',\n')}\n]}`);
}
