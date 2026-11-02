/**
 * KJC-TSK-1396 (ADR 0046): what kj stage shows, read from the files kj already
 * writes in a project. Sentinel denials, sealed gate decisions and review
 * verdicts become typed events; the Sentinel and kj review are not touched.
 *
 * Events carry only what the stage draws. A denial never carries the command
 * it blocked: that input may hold anything the agent typed.
 */
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { watch as chokidarWatch } from 'chokidar';

const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };
const firstLine = (text) => String(text ?? '').split('\n')[0];

/** A line of .karajan/harness/denials.jsonl → a sentinel-deny event, or null. */
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

/** A .karajan/reviews/<hash>.json → a review-verdict event, or null. */
export function verdictEvent(raw) {
  const r = parse(raw);
  if (!r?.verdict || !r.diffHash) return null;
  return { type: 'review-verdict', at: r.timestamp, verdict: r.verdict, reviewer: r.reviewer, host: r.host, diffHash: r.diffHash };
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
  const logs = new Map([
    [join(root, 'harness', 'denials.jsonl'), denialEvent],
    [join(root, 'policy-decisions.jsonl'), decisionEvent],
  ]);
  const tails = new Map([...logs.keys()].map((file) => [file, createTail(file)]));
  const emit = (event, raw, file) => {
    if (event) send({ ...event, project });
    else warn(`[stage-feed] skipped an unreadable record in ${file}`);
  };
  const onFile = (file) => {
    if (logs.has(file)) {
      for (const raw of tails.get(file).read()) emit(logs.get(file)(raw), raw, file);
    } else if (inReviews(file) && file.endsWith('.json')) {
      let raw;
      try { raw = readFileSync(file, 'utf8'); } catch { return; } // pruned before it was read
      emit(verdictEvent(raw), raw, file);
    }
  };
  // chokidar misses a path that did not exist when the watch began, so it
  // watches the project and lets through only the way down to these records.
  const harness = join(root, 'harness');
  const inReviews = (p) => p.startsWith(`${reviews}${sep}`);
  const wanted = (p) => [projectDir, root, harness, reviews].includes(p) || logs.has(p) || inReviews(p);
  const watcher = watch(projectDir, {
    ignored: (p) => !wanted(p),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });
  watcher.on('add', onFile);
  watcher.on('change', onFile);
  return () => watcher.close();
}
