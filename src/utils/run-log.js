/**
 * File-based run logger.
 *
 * Writes progress events to a known file so that external tools
 * (tail -f, kj_status, another Claude process) can monitor what
 * Karajan is doing in real time.
 *
 * Log location: <projectDir>/.kj/run.log  (overwritten each run)
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LOG_FILENAME = "run.log";
const LOCK_FILENAME = "run.lock";

function resolveLogDir(baseDir) {
  return path.join(baseDir || process.cwd(), ".kj");
}

function resolveLogPath(baseDir) {
  return path.join(resolveLogDir(baseDir), LOG_FILENAME);
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch { /* already exists */ }
}

function formatLine(event) {
  const ts = new Date().toISOString().slice(11, 23);
  const stage = event.stage || event.detail?.stage || "";
  const type = event.type || "info";
  const msg = event.message || "";
  const extra = [];

  if (event.detail?.provider) extra.push(`agent=${event.detail.provider}`);
  if (event.detail?.lineCount !== undefined) extra.push(`lines=${event.detail.lineCount}`);
  if (event.detail?.elapsedMs !== undefined) extra.push(`elapsed=${Math.round(event.detail.elapsedMs / 1000)}s`);
  if (event.detail?.silenceMs !== undefined) extra.push(`silence=${Math.round(event.detail.silenceMs / 1000)}s`);
  if (event.detail?.severity) extra.push(`severity=${event.detail.severity}`);
  if (event.detail?.stream) extra.push(`stream=${event.detail.stream}`);
  if (event.detail?.cooldownUntil) extra.push(`until=${event.detail.cooldownUntil}`);
  if (event.detail?.retryCount !== undefined) extra.push(`retry=${event.detail.retryCount}/${event.detail.maxRetries || "?"}`);
  if (event.detail?.remainingMs !== undefined) extra.push(`remaining=${Math.round(event.detail.remainingMs / 1000)}s`);

  const extraStr = extra.length ? ` (${extra.join(", ")})` : "";
  const stageStr = stage ? `[${stage}] ` : "";
  return `${ts} [${type}] ${stageStr}${msg}${extraStr}`;
}

export function createRunLog(projectDir) {
  const logPath = resolveLogPath(projectDir);
  const logDir = resolveLogDir(projectDir);
  ensureDir(logDir);

  // KJC-BUG-0250: the run lock, taken atomically and owned by this run's token.
  // close() releases it only while it is still ours (every caller closes in a
  // finally); a lock whose process is gone is stale and taken over.
  const startedAt = new Date().toISOString();
  const lockPath = path.join(logDir, LOCK_FILENAME);
  const token = randomUUID();
  const owned = acquireLock(lockPath, { pid: process.pid, startedAt, token });
  // Truncate/create the log file, unless another live run owns it.
  if (owned) fs.writeFileSync(logPath, `--- Karajan run started at ${startedAt} ---\n`);

  // Audit recommendation (perf-LOW): suggested createWriteStream + queue.
  // Tried it; broke the contract. `readRunLog` (used by `kj_status`,
  // `kj-tail`, and the HU board's chokidar tick) reads the file with
  // `fs.readFileSync` and expects every prior write to be visible the
  // moment the writer's `logEvent()` returns — which is what
  // `fs.writeSync(fd, ...)` guarantees and `stream.write()` does NOT.
  //
  // The current shape is already opened-once: `fs.openSync(logPath, "a")`
  // returns an fd that every subsequent `fs.writeSync` reuses (no extra
  // open/close per call). The hot-path complaint was about the FALLBACK
  // `fs.appendFileSync` line, which only fires when openSync itself
  // fails (rare; FS error or RO mount).
  let fd = null;
  try {
    fd = fs.openSync(logPath, "a");
  } catch {
    // If we can't open for append, use writeFile fallback
  }

  function write(line) {
    try {
      if (fd === null) {
        fs.appendFileSync(logPath, line + "\n");
      } else {
        fs.writeSync(fd, line + "\n");
      }
    } catch { /* best-effort */ }
  }

  function logEvent(event) {
    write(formatLine(event));
  }

  function logText(text) {
    const ts = new Date().toISOString().slice(11, 23);
    write(`${ts} ${text}`);
  }

  function close() {
    try {
      if (fd !== null) {
        fs.closeSync(fd);
        fd = null;
      }
    } catch { /* best-effort */ }
    if (owned && readLock(lockPath)?.token === token) {
      try { fs.rmSync(lockPath, { force: true }); } catch { /* best-effort */ }
    }
  }

  return {
    logEvent,
    logText,
    close,
    /** false when another live run already held the project */
    owned,
    get path() { return logPath; }
  };
}

const readLock = (lockPath) => {
  try { return JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch { return null; }
};

export const isPidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; }
};

const createExclusive = (file, body) => {
  try { fs.writeFileSync(file, body, { flag: "wx" }); return true; } catch { return false; }
};

// The lock appears with its whole content or not at all: written to a private
// file first, then hard-linked into place (link fails if the path exists), so
// nobody can read a half-written lock and take it for stale.
function linkLock(lockPath, body, token) {
  const tmp = `${lockPath}.${token}.tmp`;
  try {
    fs.writeFileSync(tmp, body);
    fs.linkSync(tmp, lockPath);
    return true;
  } catch {
    return false;
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* leftover, harmless */ }
  }
}

function acquireLock(lockPath, holder) {
  const body = JSON.stringify(holder);
  if (linkLock(lockPath, body, holder.token)) return true;
  if (isPidAlive(readLock(lockPath)?.pid)) return false;
  // Stale (its process is gone, or unreadable). Only one racer at a time may take
  // it over: the takeover mutex is itself an exclusive create. Inside it the lock
  // is read again and replaced only if it is still stale; nobody else removes it,
  // and the exclusive create that follows loses to anyone who got there first.
  const mutex = `${lockPath}.takeover`;
  clearStaleMutex(mutex);
  if (!createExclusive(mutex, holder.token)) return false;
  try {
    if (isPidAlive(readLock(lockPath)?.pid)) return false;
    try { fs.rmSync(lockPath, { force: true }); } catch { return false; }
    return linkLock(lockPath, body, holder.token);
  } finally {
    try { fs.rmSync(mutex, { force: true }); } catch { /* leftover, cleared when stale */ }
  }
}

// A takeover takes milliseconds; a mutex older than this was left by a process
// that died inside one.
const TAKEOVER_STALE_MS = 10_000;
function clearStaleMutex(mutex) {
  try {
    if (Date.now() - fs.statSync(mutex).mtimeMs > TAKEOVER_STALE_MS) fs.rmSync(mutex, { force: true });
  } catch { /* none */ }
}

const KJ_TOOLS = ["kj_run", "kj_code", "kj_plan"];

function detectRunStart(line, status) {
  const started = KJ_TOOLS.some(t => line.includes(`[${t}] started`));
  if (!started) return;
  status.isRunning = true;
  status.currentStage = KJ_TOOLS.find(t => line.includes(t));
  const tsMatch = /^(\d{2}:\d{2}:\d{2}\.\d{3})/.exec(line);
  if (tsMatch) status.startedAt = tsMatch[1];
}

function detectRunFinish(line, status) {
  const isToolFinish = KJ_TOOLS.some(t => line.includes(`[${t}] finished`) || line.includes(`[${t}]`));
  if (line.includes("finished") && isToolFinish) {
    status.isRunning = false;
  }
}

function detectStageTransitions(line, status) {
  const stageStart = /\[(\w+):start\]/.exec(line);
  if (stageStart) status.currentStage = stageStart[1];

  const stageDone = /\[(\w+):done\]|\[(\w+)\] finished/.exec(line);
  if (stageDone) {
    const doneName = stageDone[1] || stageDone[2];
    if (doneName === status.currentStage) status.currentStage = "idle";
  }
}

function detectMetadata(line, status) {
  const agentMatch = /agent=(\w+)/.exec(line);
  if (agentMatch) status.currentAgent = agentMatch[1];

  const iterMatch = /[Ii]teration\s+(\d+)/.exec(line);
  if (iterMatch) status.iteration = Number.parseInt(iterMatch[1], 10);

  if (/\[.*:fail\]|\[.*error\]/i.test(line) || line.includes("ERROR")) {
    status.errors.push(line.trim());
  }

  if (line.includes("[standby]") || line.includes("standby")) {
    status.currentStage = "standby";
  }
}

/**
 * Parse the run log to extract current status information.
 */
function parseRunStatus(lines) {
  const status = {
    currentStage: null,
    currentAgent: null,
    startedAt: null,
    isRunning: false,
    lastEvent: null,
    iteration: null,
    errors: []
  };

  for (const line of lines) {
    detectRunStart(line, status);
    detectRunFinish(line, status);
    detectStageTransitions(line, status);
    detectMetadata(line, status);
    status.lastEvent = line.trim();
  }

  if (status.errors.length > 3) status.errors = status.errors.slice(-3);
  return status;
}

/**
 * Read the current run log contents.
 * Returns the last N lines (default 50) plus a parsed status summary.
 */
export function readRunLog(projectDir, maxLines = 50) {
  const logPath = resolveLogPath(projectDir);
  try {
    const content = fs.readFileSync(logPath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    const total = lines.length;
    const shown = lines.slice(-maxLines);
    const status = parseRunStatus(lines);
    const MAX_LINE_CHARS = 2000;
    const truncated = shown.map(l => l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) + "… [truncated]" : l);
    return {
      ok: true,
      path: logPath,
      totalLines: total,
      status,
      lines: truncated,
      summary: truncated.join("\n")
    };
  } catch (err) {
    return {
      ok: false,
      path: logPath,
      error: err.code === "ENOENT"
        ? "No active run log found. Start a run with kj_run first."
        : `Failed to read log: ${err.message}`
    };
  }
}
