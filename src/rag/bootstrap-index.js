// KJC-TSK-1174 (RAG-A2): a project with no index gets one in the background, once, at the first
// command that needs it. The session goes on; queries answer from the index when it is done.
import { spawn } from "node:child_process";
import { mkdirSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectDbPath } from "./project-store.js";
import { projectSlug } from "./vec-store.js";
import { GRACE_MS, MAX_RUN_MS, indexLeasePath, readLease, takeLock, unlessGone, withMutex, writeLease } from "./pid-lease.js";

const KJ_BIN = resolve(fileURLToPath(import.meta.url), "../../../bin/kj.js");
// An attempt that died (no Ollama, no model) is not repeated on every command: this long apart.
export const RETRY_MS = 10 * 60 * 1000;
export { GRACE_MS, MAX_RUN_MS };
const markerPath = (projectDir) => `${projectDbPath(projectDir)}.bootstrap`;

/** What the marker says of the last attempt: `{ pid, at, running }`, or null when none was ever made. */
export const readBootstrap = (projectDir, o) => readLease(markerPath(projectDir), o);

/**
 * Starts `kj rag index --with-sources` detached, or reuses the one running. Returns
 * `{ started, pid }`, or `{ started: false, recent: true }` when the last attempt died less
 * than RETRY_MS ago: the index is then asked for by hand instead of being retried blindly.
 */
export function startBootstrap(projectDir, { spawnFn = spawn, bin = KJ_BIN, now = Date.now(), lease = indexLeasePath() } = {}) {
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
    // One indexer per machine: the lease is taken inside the project mutex, before the marker is
    // written, so a queued project does not spend its RETRY_MS. Both mutexes yield, never wait.
    const slug = projectSlug(projectDir);
    const res = withMutex(lease, now, () => {
      const holder = readLease(lease, { now });
      if (holder?.running && holder.pid !== process.pid) return { started: false, busy: { projectDir: holder.projectDir, slug: holder.slug, pid: holder.pid } };
      // Marker and lease land whole each time: first with the claimant's pid, so they read as
      // running meanwhile, then with the indexer's.
      const note = (pid) => { writeLease(file, { pid, at: now }); writeLease(lease, { pid, at: now, projectDir, slug }); };
      note(process.pid);
      try {
        const child = spawnFn(process.execPath, [bin, "rag", "index", "--with-sources"], { cwd: projectDir, detached: true, stdio: "ignore" });
        child.unref?.();
        note(child.pid);
        return { started: true, pid: child.pid };
      } catch (err) {
        // No indexer exists: neither the marker nor the lease may keep naming this (maybe long-lived) process.
        unlessGone(() => unlinkSync(file)); unlessGone(() => unlinkSync(lease));
        throw err;
      }
    });
    return res.busy === true ? { started: false, busy: {} } : res;
  } finally { unlessGone(() => rmdirSync(lock)); }
}
