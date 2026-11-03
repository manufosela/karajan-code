/**
 * KJC-TSK-1405 (ADR 0046): the last real state of each stage piece, so the
 * stage opens on what already happened and nothing is simulated. The shapes
 * are the stream's events (stage-feed.js).
 */
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { decisionEvent, denialEvent, verdictEvent } from './stage-feed.js';

/** The last parseable line of a jsonl, reading at most its last `tailBytes`. */
function lastRecord(file, toEvent, tailBytes) {
  let size;
  try { size = statSync(file).size; } catch { return null; }
  const length = Math.min(size, tailBytes);
  const buf = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, length, size - length); } finally { closeSync(fd); }
  const lines = buf.toString('utf8').split('\n');
  if (length < size) lines.shift(); // the first line of the tail may be cut
  for (const raw of lines.toReversed()) {
    const event = raw.trim() && toEvent(raw);
    if (event) return event;
  }
  return null;
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

export function lastStageState(projectDir, { tailBytes = 64 * 1024 } = {}) {
  const root = join(projectDir, '.karajan');
  return {
    denial: lastRecord(join(root, 'harness', 'denials.jsonl'), denialEvent, tailBytes),
    verdict: newestVerdict(join(root, 'reviews')),
    seal: lastRecord(join(root, 'policy-decisions.jsonl'), decisionEvent, tailBytes),
  };
}
