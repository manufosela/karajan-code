/**
 * HU-4211: how many unread link messages wait for a lane. kj link answers it (`kj link inbox --json`
 * reads through the permission filter and moves no cursor), so only a number leaves here: no body,
 * author or subject reaches the stage. It is a network call: kept for a while per lane, a few at a time.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { KJ_CLI } from './command-runner.js';
import { listLanes } from './lanes.js';

const INBOX_TIMEOUT_MS = 15 * 1000;
const TTL_MS = 60 * 1000;
const AT_ONCE = 4;
const cache = new Map();

/** The unread messages the output of `kj link inbox --json` counts; a thread that failed counts none. */
export function unreadOf(stdout) {
  return String(stdout).split('\n').reduce((total, raw) => {
    try { return total + (JSON.parse(raw)?.messages?.length ?? 0); } catch { return total; }
  }, 0);
}

const inbox = async (dir) => (await promisify(execFile)(process.execPath, [KJ_CLI, 'link', 'inbox', '--json'], { cwd: dir, timeout: INBOX_TIMEOUT_MS })).stdout;

/** The unread count of the lane at `dir`, or null when kj could not tell; never rejects. */
export async function unreadFacts(dir, { run = inbox } = {}) {
  try { return unreadOf(await run(dir)); } catch { return null; }
}

/** `unreadFacts` kept for a minute per lane, a read in flight shared: the stage polls. */
export function cachedUnread(dir, { now = Date.now(), read = unreadFacts } = {}) {
  const hit = cache.get(dir);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = read(dir);
  cache.set(dir, { at: now, value });
  return value;
}

/** The unread count of each lane of the project, by its dir, `limit` at a time. */
export async function laneUnreads(projectDir, { limit = AT_ONCE, read = cachedUnread, lanes = listLanes(projectDir) } = {}) {
  const queue = lanes.map(({ dir }) => dir);
  const counts = new Map();
  const worker = async () => {
    for (let dir = queue.shift(); dir; dir = queue.shift()) counts.set(dir, await read(dir));
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return counts;
}
