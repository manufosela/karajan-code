/**
 * KJC-TSK-1396 (ADR 0046): what kj stage shows, read from the files kj already
 * writes in a project. Sentinel denials, sealed gate decisions and review
 * verdicts become typed events; the Sentinel and kj review are not touched.
 *
 * Events carry only what the stage draws. A denial never carries the command
 * it blocked: that input may hold anything the agent typed.
 */
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { watch as chokidarWatch } from 'chokidar';

import { LANE_HOMES, listLanes } from './lanes.js';
import { withSessionName } from './session-names.js';
import { HANDOFFS_DIR, pendingMail } from './stage-mail.js';

/**
 * KJC-BUG-0527: the folders kj's jsonl traces live in, newest location first. The sandbox
 * makes harness/ read-only, so the traces moved to traces/; hooks sealed earlier still write
 * to harness/ until their next kj harden, so both are read.
 */
export const TRACE_DIRS = ['traces', 'harness'];

const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };
const firstLine = (text) => String(text ?? '').split('\n')[0];

/** A line of denials.jsonl (traces/, or harness/ for older hooks) → a sentinel-deny event, or null. */
export function denialEvent(raw) {
  const r = parse(raw);
  if (!r?.at || !r.tool) return null;
  return { type: 'sentinel-deny', at: r.at, tool: r.tool, why: firstLine(r.why) };
}

/** A line of .karajan/policy-decisions.jsonl → a ledger-seal event, or null. */
export function decisionEvent(raw) {
  const r = parse(raw);
  if (!r?.ts || !r.decision || !r.chokepoint) return null;
  return { type: 'ledger-seal', at: r.ts, decision: r.decision, chokepoint: r.chokepoint };
}

/** A line of commit-gate.jsonl (traces/, or harness/ for older hooks; the commit-msg guard, KJC-TSK-1401) → a commit-gate event, or null. */
export function gateEvent(raw) {
  const r = parse(raw);
  if (!r?.at || !['pass', 'refuse'].includes(r.outcome) || !r.rule) return null;
  return { type: 'commit-gate', at: r.at, outcome: r.outcome, rule: r.rule };
}

/** A line of agent-activity.jsonl (traces/, or harness/ for older hooks; KJC-TSK-1429) → an agent-activity event, or null. */
export function activityEvent(raw) {
  const r = parse(raw);
  if (!r?.at || !r.agent || !r.role || !['start', 'end'].includes(r.phase)) return null;
  // KJC-TSK-1428: the atril skills a start line names, names only.
  const skills = Array.isArray(r.skills) ? r.skills.filter((s) => typeof s === 'string') : [];
  // KJC-TSK-1434 (ADR 0048): the host's session or subagent id, the kind of tool it uses, the subagent's type.
  const name = (v) => (typeof v === 'string' ? v.slice(0, 60) : null);
  return { type: 'agent-activity', at: r.at, agent: r.agent, role: r.role, phase: r.phase, outcome: r.outcome ?? null, skills, id: name(r.id), tool: name(r.tool), kind: name(r.kind) };
}

const CARD_ACTIONS = new Set(['add', 'move']);
const CARD_STATUSES = new Set(['pending', 'running', 'done', 'failed', 'skipped']);

/**
 * KJC-TSK-1457 (ADR 0050): a line of cards.jsonl (traces/, or harness/ for older hooks; kj hu add and kj hu
 * move) → a card event, or null. The id, a short title and where it went; a move queued
 * without network says so, since the card is not there yet.
 */
export function cardEvent(raw) {
  const r = parse(raw);
  if (!r?.at || !CARD_ACTIONS.has(r.action) || typeof r.id !== 'string' || !CARD_STATUSES.has(r.status)) return null;
  const title = typeof r.title === 'string' ? r.title.slice(0, 80) : null;
  // KJC-BUG-0546: kj hu writes a lane's lines in the main checkout, naming the lane.
  const lane = typeof r.lane === 'string' && r.lane ? { lane: r.lane.slice(0, 120) } : {};
  return { type: 'card', at: r.at, action: r.action, id: r.id.slice(0, 60), title, status: r.status, queued: r.queued === true, ...lane };
}

/** A .karajan/reviews/<hash>.json → a review-verdict event, or null. */
export function verdictEvent(raw) {
  const r = parse(raw);
  if (!r?.verdict || !r.diffHash) return null;
  return { type: 'review-verdict', at: r.timestamp, verdict: r.verdict, reviewer: r.reviewer, host: r.host, diffHash: r.diffHash };
}

/**
 * KJC-TSK-1438 (ADR 0048): .karajan/harness/rag-answer.json (what the RAG last
 * answered in the lane) → a rag-answer event with how many sources it gave, or
 * null. Never the question: the agent may have asked anything.
 */
export function ragEvent(raw) {
  const r = parse(raw);
  const at = new Date(typeof r?.at === 'number' ? r.at : Number.NaN);
  // A time out of Date's range would throw in toISOString, inside the watch.
  if (!Number.isFinite(at.getTime()) || !Array.isArray(r.sources)) return null;
  return { type: 'rag-answer', at: at.toISOString(), sources: r.sources.length };
}

/** KJC-TSK-1521: .karajan/harness/rag-index.json (kj rag index starts or ends a reindex) → a rag-index event, or null. */
export function ragIndexEvent(raw) {
  const r = parse(raw);
  const at = new Date(typeof r?.at === 'number' ? r.at : Number.NaN);
  if (!Number.isFinite(at.getTime()) || !['start', 'end'].includes(r.phase)) return null;
  return { type: 'rag-index', at: at.toISOString(), phase: r.phase };
}

const sizeOf = (file) => { try { return statSync(file).size; } catch { return 0; } };

/**
 * Reads the complete lines appended to `file` since the last read. The history
 * present when the tail is made is skipped; a file that shrank was rewritten,
 * so it is read again from its start.
 */
export function createTail(file) {
  let offset = sizeOf(file);
  return {
    read() {
      const size = sizeOf(file);
      if (size < offset) offset = 0;
      if (size === offset) return [];
      const buf = Buffer.alloc(size - offset);
      let fd;
      try { fd = openSync(file, 'r'); } catch { return []; } // removed since it was measured
      try { readSync(fd, buf, 0, buf.length, offset); } finally { closeSync(fd); }
      const end = buf.lastIndexOf(0x0a);
      if (end === -1) return [];
      offset += end + 1;
      return buf.subarray(0, end).toString('utf8').split('\n').filter((l) => l.trim());
    },
  };
}

/**
 * Watches one project and sends its stage events, tagged with `project`, to
 * `send`. Returns the function that stops the watch.
 */
export function watchStageFeed(projectDir, send, { project, watch = chokidarWatch, warn = console.warn } = {}) {
  const root = join(projectDir, '.karajan');
  const reviews = join(root, 'reviews');
  const traceEvents = [['denials.jsonl', denialEvent], ['commit-gate.jsonl', gateEvent], ['agent-activity.jsonl', activityEvent], ['cards.jsonl', cardEvent]];
  const logs = new Map([
    [join(root, 'policy-decisions.jsonl'), decisionEvent],
    ...TRACE_DIRS.flatMap((dir) => traceEvents.map(([name, event]) => [join(root, dir, name), event])),
  ]);
  const tails = new Map([...logs.keys()].map((file) => [file, createTail(file)]));
  const emit = (event, raw, file) => {
    // KJC-TSK-1483: a host's robot says its session's name.
    if (event) send({ ...withSessionName(event), project });
    else warn(`[stage-feed] skipped an unreadable record in ${file}`);
  };
  const onFile = (file) => {
    if (logs.has(file)) {
      for (const raw of tails.get(file).read()) emit(logs.get(file)(raw), raw, file);
    } else if (inReviews(file) && file.endsWith('.json')) {
      let raw;
      try { raw = readFileSync(file, 'utf8'); } catch { return; } // pruned before it was read
      emit(verdictEvent(raw), raw, file);
    } else if (inHandoffs(file)) {
      // KJC-TSK-1472: a handoff added or marked done changes the lane's mail.
      send({ type: 'mail', pending: pendingMail(projectDir), project });
    } else if (notes.has(file)) {
      // Rewritten on every query or phase: it is new only when its time or its phase moved on.
      let raw;
      try { raw = readFileSync(file, 'utf8'); } catch { return; }
      const event = notes.get(file)(raw);
      const key = event && `${event.at}:${event.phase ?? ''}`;
      if (event && key !== lastNote.get(file)) { lastNote.set(file, key); send({ ...event, project }); }
    }
  };
  // KJC-TSK-1438, 1521: what the RAG last answered and whether it is reindexing.
  const notes = new Map([[join(root, 'harness', 'rag-answer.json'), ragEvent], [join(root, 'harness', 'rag-index.json'), ragIndexEvent]]);
  const lastNote = new Map();
  // chokidar misses a path that did not exist when the watch began, so it
  // watches the project and lets through only the way down to these records.
  const traceDirs = TRACE_DIRS.map((dir) => join(root, dir));
  const inReviews = (p) => p.startsWith(`${reviews}${sep}`);
  const handoffs = join(projectDir, ...HANDOFFS_DIR);
  const inHandoffs = (p) => p.startsWith(`${handoffs}${sep}`) && p.endsWith('.json');
  const wanted = (p) => [projectDir, root, ...traceDirs, reviews, handoffs].includes(p) || logs.has(p) || notes.has(p) || inReviews(p) || inHandoffs(p);
  const watcher = watch(projectDir, {
    ignored: (p) => !wanted(p),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });
  watcher.on('add', onFile);
  watcher.on('change', onFile);
  return () => watcher.close();
}

/**
 * KJC-TSK-1432 (ADR 0048): watches every lane of a project (the main checkout
 * and each worktree) and tags each event with its lane. A worktree born after
 * the watch began is followed; one removed stops being watched.
 */
export function watchLanes(projectDir, send, { project, watch = chokidarWatch, warn = console.warn } = {}) {
  const feeds = new Map();
  const follow = ({ lane, dir }) => {
    if (feeds.has(dir)) return;
    // An event that names its own lane keeps it (KJC-BUG-0546: card lines written from a lane).
    feeds.set(dir, watchStageFeed(dir, (event) => send({ lane, ...event }), { project, watch, warn }));
  };
  listLanes(projectDir).forEach(follow);
  const homes = LANE_HOMES.map((home) => join(projectDir, ...home));
  const onTheWay = new Set([projectDir, ...LANE_HOMES.map(([top]) => join(projectDir, top)), ...homes]);
  const doors = watch(projectDir, {
    depth: 2,
    ignored: (p) => !onTheWay.has(p) && !homes.includes(dirname(p)),
    ignoreInitial: true,
  });
  doors.on('addDir', (p) => { if (homes.includes(dirname(p))) follow({ lane: basename(p), dir: p }); });
  doors.on('unlinkDir', (p) => { feeds.get(p)?.(); feeds.delete(p); });
  return () => {
    doors.close();
    for (const stop of feeds.values()) stop();
    feeds.clear();
  };
}
