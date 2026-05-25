// KJC-TSK-0441 — `kj watch [start|stop|status]`. Thin wrappers.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startWatcher, readPidFile, clearPidFile, isPidAlive, writePidFile } from "../rag/watcher.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export async function watchStartCommand({ config, logger, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const existing = readPidFile();
  if (existing && isPidAlive(existing)) { logger.info(`Watcher already running (pid ${existing}).`); return { pid: existing, started: false }; }
  if (existing) clearPidFile();
  if (flags.foreground) {
    writePidFile();
    const stop = startWatcher({ projectDir, config, logger, withSources: !!flags.withSources });
    const shutdown = async () => { await stop(); clearPidFile(); process.exit(0); };
    process.on("SIGINT", shutdown).on("SIGTERM", shutdown);
    logger.info(`Watcher started in foreground (pid ${process.pid}). Ctrl+C to stop.`);
    return { pid: process.pid, started: true };
  }
  const args = [join(HERE, "..", "cli.js"), "watch", "start", "--foreground", ...(flags.withSources ? ["--with-sources"] : [])];
  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore", env: { ...process.env, KJ_WATCHER_DAEMON: "1" } });
  child.unref();
  logger.info(`Watcher started in background (pid ${child.pid}).`);
  return { pid: child.pid, started: true };
}

export async function watchStopCommand({ logger }) {
  const pid = readPidFile();
  if (!pid) { logger.info("No watcher running."); return { stopped: false }; }
  if (!isPidAlive(pid)) { clearPidFile(); logger.info(`Stale PID file removed (process ${pid} was not alive).`); return { stopped: false, stale: true }; }
  try { process.kill(pid, "SIGTERM"); } catch (err) { logger.warn(`Could not signal pid ${pid}: ${err.message}`); }
  clearPidFile();
  logger.info(`Watcher (pid ${pid}) stopped.`);
  return { stopped: true, pid };
}

export async function watchStatusCommand({ logger }) {
  const pid = readPidFile();
  const alive = pid && isPidAlive(pid);
  if (alive) logger.info(`Watcher running (pid ${pid}).`);
  else if (pid) logger.warn(`Stale PID file (process ${pid} not alive). Run \`kj watch stop\` to clean up.`);
  else logger.info("Watcher is NOT running.");
  return { pid, alive };
}
