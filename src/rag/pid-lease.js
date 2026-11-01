// HU-2757: a lease names the pid that holds a resource and when it took it. The background indexers
// never release it (HU-2907: a foreground `kj rag index` releases its own): a dead pid, or an age
// of MAX_RUN_MS, means free. A mkdir mutex makes the decision atomic.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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
    return { ...note, running: !note.stoppedAt && alive(note.pid) && now - note.at < MAX_RUN_MS };
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

// HU-2758: an indexer past MAX_RUN_MS is stopped from outside, once ps confirms the pid still runs it.
export const KILL_AFTER_MS = 3000;
const POLL_MS = 100;
const START_SLACK_MS = 60 * 1000;
// By absolute path: a ps found through PATH could be forged (as in harden/human-act.js).
const PS_BIN = ["/bin/ps", "/usr/bin/ps"].find((p) => existsSync(p)) ?? null;

/** `ps -o etime= -o command=` output as `{ elapsedMs, command }`, or null. */
export function parsePs(out) {
  const text = String(out ?? "").trim();
  const split = text.search(/\s/);
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(text.slice(0, split < 0 ? 0 : split));
  const command = text.slice(split).trim();
  if (!m || split < 0 || !command) return null;
  const [d, h, min, s] = [m[1], m[2], m[3], m[4]].map((n) => Number(n ?? 0));
  return { elapsedMs: (((d * 24 + h) * 60 + min) * 60 + s) * 1000, command };
}

// No system ps (Windows), or it failed: null, and nothing is stopped.
const psInfo = (pid) => {
  if (!PS_BIN) return null;
  try { return parsePs(execFileSync(PS_BIN, ["-o", "etime=", "-o", "command=", "-p", String(pid)], { encoding: "utf8", env: {}, timeout: 2000 })); }
  catch { return null; }
};
// Anchored on the executable: startBootstrap spawns `node <kj.js> rag index`, so `vim kj rag index` is not one.
const INDEXER_COMMAND = /^\S*node\S*\s+\S*\/kj(?:\.js)?\s+rag\s+index(?:\s|$)/;
const isIndexer = (info, at, now) => Boolean(info) && INDEXER_COMMAND.test(info.command) && info.elapsedMs >= Math.max(0, now - at - START_SLACK_MS);
const isAliveVia = (kill, pid) => { try { kill(pid, 0); return true; } catch { return false; } };
// The indexer leads its own process group (spawned detached): -pid reaches its whole tree.
const signal = (kill, pid, sig) => {
  try { kill(-pid, sig); } catch { try { kill(pid, sig); } catch (err) { if (err.code !== "ESRCH") throw err; } }
};

/** SIGTERM to a verified indexer, SIGKILL if it outlives `killAfterMs`. True only once it is confirmed gone. */
export async function stopIndexer(pid, at, { now = Date.now(), ps = psInfo, kill = (p, s) => process.kill(p, s), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), killAfterMs = KILL_AFTER_MS } = {}) {
  if (!isIndexer(ps(pid), at, now)) return false;
  signal(kill, pid, "SIGTERM");
  for (let waited = 0; waited < killAfterMs; waited += POLL_MS) {
    await sleep(POLL_MS);
    if (!isAliveVia(kill, pid)) return true;
  }
  const again = ps(pid); // verified again: no answer is gone-or-unverified, never signalled blind
  if (!again) return !isAliveVia(kill, pid);
  if (!isIndexer(again, at, now)) return true; // the pid was reused: the indexer is gone
  signal(kill, pid, "SIGKILL");
  await sleep(POLL_MS);
  return !isAliveVia(kill, pid);
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// Notes the stop while the file still names that pid: 5 tries at the mutex, 20 ms apart; false if never free.
const noteStopped = (file, pid, now, reason, wait) => {
  const mark = () => withMutex(file, now, () => {
    const { running: _running, ...note } = readLease(file, { now }) ?? {};
    if (note.pid === pid && !note.stoppedAt) writeLease(file, { ...note, stoppedAt: now, stoppedBy: reason });
    return true;
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) wait(20);
    if (mark() === true) return true;
  }
  return false;
};

// Stops the process `file` names past MAX_RUN_MS (or `force`) and notes it there: `{ pid, slug }` or null.
export async function stopLeaseHolder(file, { force = false, now = Date.now(), ...io } = {}) {
  const held = readLease(file, { now });
  const kill = io.kill ?? ((p, s) => process.kill(p, s));
  if (!Number.isInteger(held?.pid) || held.pid <= 1 || held.pid === process.pid || held.stoppedAt || !isAliveVia(kill, held.pid)) return null;
  if (!force && now - held.at < MAX_RUN_MS) return null;
  if (!(await stopIndexer(held.pid, held.at, { ...io, now, kill }))) return null;
  const marked = noteStopped(file, held.pid, now, force ? "lane-done" : "max-run", io.wait ?? sleepSync);
  return { pid: held.pid, slug: held.slug, marked };
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
