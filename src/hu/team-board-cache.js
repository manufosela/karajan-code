/**
 * KJC-TSK-1165 (TEAM-GH-D, ADR 0025): the local copy of the shared board, and the
 * queue of moves made without network. The copy is a cache, never the truth: it
 * is rewritten on every answer from GitHub and only read when GitHub does not
 * answer. A queued move is applied when the network is back; one GitHub rejects
 * (someone else holds the HU) is reported and dropped, never forced. Creating a
 * HU offline is refused elsewhere: an id is only ever minted by GitHub.
 */
import fs from "node:fs";
import path from "node:path";
import { isOffline, isRefusal } from "./board-errors.js";

// The file is the board's own (board-key.js): GitHub's is the one kj has always used.
const CACHE_FILE = ".karajan/board-cache.json";
// A fresh object every time: a shared default array would carry one read's queue into the next.
const empty = () => ({ hus: null, updatedAt: null, queue: [] });

export function readCache(projectDir, file = CACHE_FILE) {
  try {
    const cache = { ...empty(), ...JSON.parse(fs.readFileSync(path.join(projectDir, file), "utf8")) };
    // A queue written by an older kj stored the issue number: it is HU-<number>, never lost.
    cache.queue = cache.queue.map((op) => (op.id ? op : { ...op, id: `HU-${op.number}` }));
    return cache;
  } catch (err) {
    if (err.code === "ENOENT") return empty();
    throw err;
  }
}

function writeCache(projectDir, cache, file) {
  const target = path.join(projectDir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

/** The HUs from the manager (and the copy refreshed), or the copy when it cannot be reached. */
export async function listWithCache({ projectDir, file = CACHE_FILE, list }) {
  try {
    const rows = await list();
    writeCache(projectDir, { ...readCache(projectDir, file), hus: rows, updatedAt: new Date().toISOString() }, file);
    return { source: "github", rows }; // the name is kept for existing callers: anything but "cache"
  } catch (err) {
    const cache = readCache(projectDir, file);
    if (!isOffline(err) || !cache.hus) throw err;
    return { source: "cache", rows: cache.hus, updatedAt: cache.updatedAt };
  }
}

/**
 * Remember a move to apply when the network is back. `expected` is the status the local
 * copy shows now (null when the copy does not know the HU): when it is applied, a HU that
 * moved meanwhile is a conflict, not something to overwrite. The copy takes the move so a
 * second queued move on the same HU expects the first one's result.
 */
export function queueMove({ projectDir, file = CACHE_FILE, id, status, who, release }) {
  const cache = readCache(projectDir, file);
  const row = cache.hus?.find((h) => h.short_id === id) ?? null;
  cache.queue.push({ id, status, who, release: Boolean(release), expected: row?.status ?? null, queuedAt: new Date().toISOString() });
  if (row) row.status = status;
  writeCache(projectDir, cache, file);
  return cache.queue.length;
}

/**
 * Apply the queue in order. A move GitHub refuses is a conflict: reported, dropped, the
 * HU stays as the other person left it. Still offline: stop, keep the rest for later.
 * Any other error is kj's own: it surfaces, and the move stays queued.
 * @returns {Promise<{applied: number, conflicts: string[], pending: number}>}
 */
export async function flushQueue({ projectDir, file = CACHE_FILE, apply }) {
  const cache = readCache(projectDir, file);
  const conflicts = [];
  let applied = 0;
  while (cache.queue.length > 0) {
    const op = cache.queue[0];
    try {
      await apply(op);
      applied += 1;
    } catch (err) {
      if (isOffline(err)) break;
      if (!isRefusal(err)) throw err;
      conflicts.push(`${op.id} → ${op.status} (queued ${op.queuedAt}) not applied: ${err.message}`);
    }
    cache.queue.shift();
    writeCache(projectDir, cache, file);
  }
  return { applied, conflicts, pending: cache.queue.length };
}
