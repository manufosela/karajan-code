import { readFileSync, writeFileSync, unlinkSync, watch, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const RESTART_MARKER_DIR = path.join(os.homedir(), ".kj");
const RESTART_MARKER_PATH = path.join(RESTART_MARKER_DIR, ".mcp-restart");

const DEFAULT_INTERVAL_MS = 5000;

export function setupOrphanGuard({ intervalMs = DEFAULT_INTERVAL_MS, exitFn = () => process.exit(0) } = {}) {
  const parentPid = process.ppid;

  const timer = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch { /* parent process is gone */
      clearInterval(timer);
      exitFn();
    }
  }, intervalMs);
  timer.unref();

  process.stdin.on("end", exitFn);
  process.stdin.on("close", exitFn);
  process.on("SIGHUP", exitFn);

  return { timer, parentPid };
}

const DEFAULT_MEMORY_CHECK_MS = 30_000;
const DEFAULT_WARN_HEAP_MB = 512;
const DEFAULT_CRITICAL_HEAP_MB = 768;

export function setupMemoryWatchdog({
  intervalMs = DEFAULT_MEMORY_CHECK_MS,
  warnHeapMb = DEFAULT_WARN_HEAP_MB,
  criticalHeapMb = DEFAULT_CRITICAL_HEAP_MB,
  onWarn = null,
  onCritical = null,
  exitFn = () => process.exit(1)
} = {}) {
  const warnBytes = warnHeapMb * 1024 * 1024;
  const criticalBytes = criticalHeapMb * 1024 * 1024;
  let warned = false;

  const timer = setInterval(() => {
    const { heapUsed, rss } = process.memoryUsage();

    if (heapUsed >= criticalBytes) {
      if (global.gc) {
        try { global.gc(); } catch { /* --expose-gc not set */ }
        const after = process.memoryUsage().heapUsed;
        if (after < criticalBytes) return; // GC freed enough
      }
      const msg = `Memory critical: heap ${(heapUsed / 1024 / 1024).toFixed(0)}MB / rss ${(rss / 1024 / 1024).toFixed(0)}MB — exiting to prevent OOM`;
      if (onCritical) onCritical(msg);
      else process.stderr.write(`[karajan-mcp] ${msg}\n`);
      clearInterval(timer);
      exitFn();
      return;
    }

    if (heapUsed >= warnBytes && !warned) {
      warned = true;
      const msg = `Memory warning: heap ${(heapUsed / 1024 / 1024).toFixed(0)}MB / rss ${(rss / 1024 / 1024).toFixed(0)}MB (critical at ${criticalHeapMb}MB)`;
      if (onWarn) onWarn(msg);
      else process.stderr.write(`[karajan-mcp] ${msg}\n`);
    } else if (heapUsed < warnBytes) {
      warned = false;
    }
  }, intervalMs);
  timer.unref();

  return { timer };
}

const DEFAULT_GRACE_MS = 2000;

export function writeRestartMarker(version, markerPath = RESTART_MARKER_PATH) {
  try {
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, version, "utf8");
  } catch { /* best-effort */ }
}

export function readAndDeleteRestartMarker(markerPath = RESTART_MARKER_PATH) {
  try {
    if (!existsSync(markerPath)) return null;
    const version = readFileSync(markerPath, "utf8").trim();
    unlinkSync(markerPath);
    return version || null;
  } catch { /* ignore */ }
  return null;
}

export function setupVersionWatcher({
  pkgPath,
  currentVersion,
  gracePeriodMs = DEFAULT_GRACE_MS,
  exitFn = () => process.exit(0),
  markerPath = RESTART_MARKER_PATH
} = {}) {
  if (!pkgPath) return null;

  let _gracePeriodMs = gracePeriodMs;

  function checkVersion() {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.version !== currentVersion) {
        const newVersion = pkg.version;
        process.stderr.write(
          `[karajan-mcp] Karajan MCP updated (v${currentVersion} → v${newVersion}). Restarting...\n`
        );
        writeRestartMarker(newVersion, markerPath);
        setTimeout(() => exitFn(), _gracePeriodMs);
        return true;
      }
    } catch { /* ignore read errors */ }
    return false;
  }

  let watcher = null;
  try {
    watcher = watch(pkgPath, { persistent: false }, () => {
      checkVersion();
    });
  } catch { /* ignore watch errors */ }

  return { watcher, checkVersion, get gracePeriodMs() { return _gracePeriodMs; }, set gracePeriodMs(v) { _gracePeriodMs = v; } };
}
