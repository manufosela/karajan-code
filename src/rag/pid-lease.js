// HU-2757: a lease names the pid that holds a resource and when it took it. The background indexers
// never release it (HU-2907: a foreground `kj rag index` releases its own): a dead pid, or an age
// of MAX_RUN_MS, means free. A mkdir mutex makes the decision atomic.
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getKarajanHome } from "../utils/paths.js";

// A lease that does not parse, or a lock, older than this was left by a crashed command: taken over.
export const GRACE_MS = 30 * 1000;
// An indexer is not trusted to run longer than this: past it, its pid may belong to someone else.
export const MAX_RUN_MS = 60 * 60 * 1000;

export const indexLeasePath = () => join(getKarajanHome(), "locks", "rag-index.json");

// EPERM (a pid of another user) counts as dead: a single-user machine has no such indexer.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export const unlessGone = (fn) => {
  try { return fn(); }
  catch (err) {
    if (err.code === "ENOENT") { return null; }
    throw err;
  }
};

/** What the lease says: `{ pid, at, running, ... }`, or null when none was ever written. */
export function readLease(file, { now = Date.now() } = {}) {
  // Read first, never check-then-read: another command may set the file aside in between.
  const raw = unlessGone(() => readFileSync(file, "utf8"));
  if (raw === null) return null;
  try {
    const note = JSON.parse(raw);
    return { ...note, running: alive(note.pid) && now - note.at < MAX_RUN_MS };
  } catch {
    // Another command is writing it this very moment: running for a moment; past the grace, a crash.
    const stat = unlessGone(() => statSync(file));
    return stat === null ? null : { pid: null, at: 0, running: now - stat.mtimeMs < GRACE_MS };
  }
}

/** The lease lands whole: written apart, then renamed. */
export function writeLease(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(record), "utf8");
  renameSync(tmp, file);
}

export const takeLock = (lock, now) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { mkdirSync(lock); return true; }
    catch (err) {
      if (err.code !== "EEXIST") throw err;
      const held = unlessGone(() => statSync(lock));
      if (held && now - held.mtimeMs < GRACE_MS) return false;
      // The holder crashed. The lock is set aside under a unique name first: only the one caller
      // whose rename succeeds removes it, so nobody removes a lock another caller has just taken.
      const aside = `${lock}.${process.pid}.${now}.stale`;
      if (unlessGone(() => renameSync(lock, aside)) !== null) rmdirSync(aside);
    }
  }
  return false;
};

/** Runs `fn` under the mutex `${file}.lock`, or returns `{ busy: true }` when another command holds it. */
export function withMutex(file, now, fn) {
  const lock = `${file}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  if (!takeLock(lock, now)) return { busy: true };
  try { return fn(); } finally { unlessGone(() => rmdirSync(lock)); }
}

// Overlapping claims of one process (two MCP requests in a host share its pid): the lease goes with the last.
const claims = new Map();
const RELEASE_TRIES = 5;
const RELEASE_WAIT_MS = 20;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * HU-2907: claims the lease for `pid` unless another live process holds it. Never waits. A holder
 * in `kin` (the spawning parent, which names itself before the child's pid lands) is not "another".
 */
export function claimLease(file, record, { now = Date.now(), pid = process.pid, kin = [] } = {}) {
  const res = withMutex(file, now, () => {
    const holder = readLease(file, { now });
    if (holder?.running && holder.pid !== pid && !kin.includes(holder.pid)) return { claimed: false, holder };
    writeLease(file, { ...record, pid, at: now });
    claims.set(file, (claims.get(file) ?? 0) + 1);
    return { claimed: true };
  });
  return res.busy === true ? { claimed: false, busy: true } : res;
}

/** Removes the lease only while it still names `pid`: never another process's claim. */
export function releaseLease(file, { pid = process.pid, now = Date.now(), sleep = pause } = {}) {
  // This claim is over whatever the mutex says: counted down once, so a busy mutex never leaves it stale.
  const left = (claims.get(file) ?? 1) - 1;
  if (left > 0) { claims.set(file, left); return { released: false, shared: true }; }
  claims.delete(file);
  const release = () => withMutex(file, now, () => {
    if (readLease(file, { now })?.pid !== pid) return { released: false };
    unlessGone(() => unlinkSync(file));
    return { released: true };
  });
  // Up to RELEASE_TRIES attempts while the mutex is busy; past that the lease expires on its own (dead pid, or MAX_RUN_MS).
  let res = release();
  for (let attempt = 1; res.busy === true && attempt < RELEASE_TRIES; attempt += 1) { sleep(RELEASE_WAIT_MS); res = release(); }
  return res;
}
