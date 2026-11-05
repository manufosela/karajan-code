/**
 * KJC-TSK-1405 (ADR 0046): the last real state of each stage piece, so the
 * stage opens on what already happened and nothing is simulated. The shapes
 * are the stream's events (stage-feed.js).
 */
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { listLanes } from './lanes.js';
import { activityEvent, decisionEvent, denialEvent, gateEvent, verdictEvent } from './stage-feed.js';

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

const lastRecord = (file, toEvent, tailBytes) => tailRecords(file, toEvent, tailBytes).at(-1) ?? null;

/** KJC-TSK-1430: the agents whose last trace is a recent start, by agent and role. */
function agentsAtWork(file, tailBytes, now) {
  const last = new Map();
  for (const ev of tailRecords(file, activityEvent, tailBytes)) last.set(`${ev.agent}:${ev.role}`, ev);
  return [...last.values()]
    .filter((ev) => ev.phase === 'start' && now - Date.parse(ev.at) < STALE_START_MS)
    .map(({ agent, role, at }) => ({ agent, role, at }));
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

export function lastStageState(projectDir, { tailBytes = 64 * 1024, now = Date.now() } = {}) {
  const root = join(projectDir, '.karajan');
  return {
    denial: lastRecord(join(root, 'harness', 'denials.jsonl'), denialEvent, tailBytes),
    verdict: newestVerdict(join(root, 'reviews')),
    seal: lastRecord(join(root, 'policy-decisions.jsonl'), decisionEvent, tailBytes),
    gate: lastRecord(join(root, 'harness', 'commit-gate.jsonl'), gateEvent, tailBytes),
    working: agentsAtWork(join(root, 'harness', 'agent-activity.jsonl'), tailBytes, now),
  };
}

/** KJC-TSK-1432 (ADR 0048): the last state of every lane, the main checkout first. */
export const laneStates = (projectDir, options) =>
  listLanes(projectDir).map(({ lane, dir }) => ({ lane, ...lastStageState(dir, options) }));
