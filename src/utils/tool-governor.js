/**
 * tool-governor — resource governance for external tools launched by kj
 * (KJC-TSK-0668), born from a real semgrep CPU storm: single-flight across
 * processes (pid-stamped lockfile, stale locks stolen), jobs cap (half the
 * CPUs), nice +10 best-effort, and hard timeouts that kill the PROCESS TREE
 * (own process group on POSIX). In-process cousin: async-lock.js.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_LOCKS_DIR = path.join(os.homedir(), ".karajan", "locks");
const NICENESS = 10;

/** Parallelism cap for scanner `--jobs` flags: half the CPUs, min 1. */
export function jobsCap(cpuCount = os.cpus().length) {
  return Math.max(1, Math.floor(cpuCount / 2));
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // alive but owned by another user
  }
}

/** Machine-wide lock for `tool` → {release}; ELOCKTIMEOUT if the live holder outlasts `timeoutMs`. */
export async function acquireToolLock(tool, { locksDir = DEFAULT_LOCKS_DIR, timeoutMs = 180_000, pollMs = 500 } = {}) {
  fs.mkdirSync(locksDir, { recursive: true });
  const lockPath = path.join(locksDir, `${tool}.lock`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // wx = atomic create-or-fail: the filesystem is the arbiter.
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      fs.closeSync(fd);
      return { release: () => fs.rmSync(lockPath, { force: true }) };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let holder = null;
      try {
        holder = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      } catch { /* unreadable → stale */ }
      if (!holder || !Number.isInteger(holder.pid) || !isPidAlive(holder.pid)) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        const e = new Error(`${tool} is already running (pid ${holder.pid}, since ${holder.startedAt}) — gave up waiting after ${timeoutMs}ms`);
        e.code = "ELOCKTIMEOUT";
        throw e;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

/**
 * Governed spawn: own process group (POSIX), lowered priority, timeout kills
 * the whole tree. Rejections mirror execFile's contract (err.code /
 * err.killed / err.stdout) so scanner collectors keep their error handling.
 */
export function governedExecFile(bin, args, { cwd, timeout = 0, maxBuffer = 16 * 1024 * 1024, niceness = NICENESS } = {}) {
  return new Promise((resolve, reject) => {
    const posix = process.platform !== "win32";
    const child = spawn(bin, args, { cwd, detached: posix, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killedByGovernor = false, timer = null;
    const killTree = () => {
      killedByGovernor = true;
      try {
        if (posix) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { /* tree already gone */ }
    };
    if (timeout > 0) timer = setTimeout(killTree, timeout);
    child.on("spawn", () => {
      try {
        os.setPriority(child.pid, niceness);
      } catch { /* best-effort */ }
    });
    const bufferBlown = () => stdout.length + stderr.length > maxBuffer;
    child.stdout.on("data", (d) => { stdout += d; if (bufferBlown()) killTree(); });
    child.stderr.on("data", (d) => { stderr += d; if (bufferBlown()) killTree(); });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(Object.assign(err, { stdout, stderr }));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (killedByGovernor) {
        reject(Object.assign(new Error(`${bin} killed by governor after ${timeout}ms (process tree included)`), { killed: true, stdout, stderr }));
      } else if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(Object.assign(new Error(`${bin} exited with code ${code}`), { code, stdout, stderr }));
      }
    });
  });
}

/** Lock + governed exec + guaranteed release. `opts.bin` overrides the executable. */
export async function runGoverned(tool, args, opts = {}) {
  const lock = await acquireToolLock(tool, opts.lock);
  try {
    return await governedExecFile(opts.bin || tool, args, opts);
  } finally {
    lock.release();
  }
}
