// KJC-TSK-1174 (RAG-A2): a project with no index gets one in the background, once, at the first
// command that needs it. The session goes on; queries answer from the index when it is done.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectDbPath } from "./project-store.js";

const KJ_BIN = resolve(fileURLToPath(import.meta.url), "../../../bin/kj.js");
// An attempt that died (no Ollama, no model) is not repeated on every command: this long apart.
export const RETRY_MS = 10 * 60 * 1000;
// A marker that does not parse, or a lock, older than this was left by a crashed command: taken over.
export const GRACE_MS = 30 * 1000;
// An indexer is not trusted to run longer than this: past it, its pid may belong to someone else.
export const MAX_RUN_MS = 60 * 60 * 1000;
const markerPath = (projectDir) => `${projectDbPath(projectDir)}.bootstrap`;

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** What the marker says of the last attempt: `{ pid, at, running }`, or null when none was ever made. */
const unlessGone = (fn) => {
  try { return fn(); }
  catch (err) {
    if (err.code === "ENOENT") { return null; }
    throw err;
  }
};

export function readBootstrap(projectDir, { now = Date.now() } = {}) {
  const file = markerPath(projectDir);
  // Read first, never check-then-read: another command may set the marker aside in between.
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

/**
 * Starts `kj rag index --with-sources` detached, or reuses the one running. Returns
 * `{ started, pid }`, or `{ started: false, recent: true }` when the last attempt died less
 * than RETRY_MS ago: the index is then asked for by hand instead of being retried blindly.
 */
export function startBootstrap(projectDir, { spawnFn = spawn, bin = KJ_BIN, now = Date.now() } = {}) {
  const file = markerPath(projectDir);
  mkdirSync(dirname(file), { recursive: true });
  // One claimant at a time: the lock directory is created atomically, so of two commands arriving
  // together only one reads the marker and decides.
  const lock = `${file}.lock`;
  const reuse = () => ({ started: false, pid: readBootstrap(projectDir, { now })?.pid ?? null });
  if (!takeLock(lock, now)) return reuse();
  try {
    const last = readBootstrap(projectDir, { now });
    if (last?.running) return { started: false, pid: last.pid };
    if (last && now - last.at < RETRY_MS) return { started: false, recent: true, pid: null };
    // The marker lands whole each time (written apart, then renamed): first with the claimant's
    // pid, so it reads as running meanwhile, then with the indexer's.
    const note = (pid) => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify({ pid, at: now }), "utf8"); renameSync(tmp, file); };
    note(process.pid);
    const child = spawnFn(process.execPath, [bin, "rag", "index", "--with-sources"], { cwd: projectDir, detached: true, stdio: "ignore" });
    child.unref?.();
    note(child.pid);
    return { started: true, pid: child.pid };
  } finally { unlessGone(() => rmdirSync(lock)); }
}

const takeLock = (lock, now) => {
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
