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
import { isOffline, isRefusal } from "./github-board.js";

const CACHE_FILE = ".karajan/board-cache.json";
// A fresh object every time: a shared default array would carry one read's queue into the next.
const empty = () => ({ hus: null, updatedAt: null, queue: [] });

export function readCache(projectDir) {
  try {
    return { ...empty(), ...JSON.parse(fs.readFileSync(path.join(projectDir, CACHE_FILE), "utf8")) };
  } catch (err) {
    if (err.code === "ENOENT") return empty();
    throw err;
  }
}

function writeCache(projectDir, cache) {
  const file = path.join(projectDir, CACHE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

/** The HUs from GitHub (and the copy refreshed), or the copy when GitHub cannot be reached. */
export async function listWithCache({ projectDir, repo, list }) {
  try {
    const rows = await list({ repo });
    writeCache(projectDir, { ...readCache(projectDir), hus: rows, updatedAt: new Date().toISOString() });
    return { source: "github", rows };
  } catch (err) {
    const cache = readCache(projectDir);
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
export function queueMove({ projectDir, number, status, who, release }) {
  const cache = readCache(projectDir);
  const row = cache.hus?.find((h) => h.number === number) ?? null;
  cache.queue.push({ number, status, who, release: Boolean(release), expected: row?.status ?? null, queuedAt: new Date().toISOString() });
  if (row) row.status = status;
  writeCache(projectDir, cache);
  return cache.queue.length;
}

/**
 * Apply the queue in order. A move GitHub refuses is a conflict: reported, dropped, the
 * HU stays as the other person left it. Still offline: stop, keep the rest for later.
 * Any other error is kj's own: it surfaces, and the move stays queued.
 * @returns {Promise<{applied: number, conflicts: string[], pending: number}>}
 */
export async function flushQueue({ projectDir, apply }) {
  const cache = readCache(projectDir);
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
      conflicts.push(`HU-${op.number} → ${op.status} (queued ${op.queuedAt}) not applied: ${err.message}`);
    }
    cache.queue.shift();
    writeCache(projectDir, cache);
  }
  return { applied, conflicts, pending: cache.queue.length };
}
