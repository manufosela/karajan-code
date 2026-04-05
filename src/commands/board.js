import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getKarajanHome } from "../utils/paths.js";

const BOARD_DIR = path.resolve(import.meta.dirname, "../../packages/hu-board");
const PID_FILE = path.join(getKarajanHome(), "hu-board.pid");

function readPid() {
  try {
    const pid = Number.parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch { /* PID file does not exist */
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch { /* process does not exist */
    return false;
  }
}

export async function startBoard(port = 4000) {
  const existingPid = readPid();
  if (existingPid && isProcessAlive(existingPid)) {
    return { ok: true, alreadyRunning: true, pid: existingPid, url: `http://localhost:${port}` };
  }

  const serverPath = path.join(BOARD_DIR, "src/server.js");
  const karajanHome = getKarajanHome();
  fs.mkdirSync(karajanHome, { recursive: true });

  // Use process.execPath (absolute path to current node binary) instead of "node".
  // Fixes ENOENT on nvm setups where `node` is not in the spawned process's PATH.
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port) },
    detached: true,
    stdio: "ignore",
    cwd: BOARD_DIR
  });
  // Swallow spawn errors so an HU Board failure never crashes the pipeline.
  child.on("error", () => { /* non-blocking — caller logs via tryAutoStartBoard catch */ });
  child.unref();

  if (!child.pid) {
    throw new Error("Failed to spawn HU Board server");
  }
  fs.writeFileSync(PID_FILE, String(child.pid));
  return { ok: true, alreadyRunning: false, pid: child.pid, url: `http://localhost:${port}` };
}

export async function stopBoard() {
  const pid = readPid();
  if (!pid || !isProcessAlive(pid)) {
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    return { ok: true, wasRunning: false };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch { /* process already dead */
    // already dead
  }
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  return { ok: true, wasRunning: true, pid };
}

export async function boardStatus(port = 4000) {
  const pid = readPid();
  const running = pid !== null && isProcessAlive(pid);
  return {
    ok: true,
    running,
    pid: running ? pid : null,
    url: running ? `http://localhost:${port}` : null
  };
}

export async function boardCommand({ action = "start", port = 4000, logger }) {
  switch (action) {
    case "start": {
      const result = await startBoard(port);
      if (result.alreadyRunning) {
        logger.info(`HU Board already running (PID ${result.pid}) at ${result.url}`);
      } else {
        logger.info(`HU Board started (PID ${result.pid}) at ${result.url}`);
      }
      return result;
    }
    case "stop": {
      const result = await stopBoard();
      if (result.wasRunning) {
        logger.info(`HU Board stopped (PID ${result.pid})`);
      } else {
        logger.info("HU Board was not running");
      }
      return result;
    }
    case "status": {
      const result = await boardStatus(port);
      if (result.running) {
        logger.info(`HU Board is running (PID ${result.pid}) at ${result.url}`);
      } else {
        logger.info("HU Board is not running");
      }
      return result;
    }
    case "open": {
      const status = await boardStatus(port);
      if (!status.running) {
        logger.info("HU Board is not running. Starting it first...");
        await startBoard(port);
      }
      const url = `http://localhost:${port}`;
      const { default: open } = await import("open").catch(() => ({ default: null }));
      if (open) {
        await open(url);
        logger.info(`Opened ${url}`);
      } else {
        logger.info(`Open in browser: ${url}`);
      }
      return { ok: true, url };
    }
    default:
      logger.error(`Unknown board action: ${action}. Use start|stop|status|open`);
      return { ok: false, error: `Unknown action: ${action}` };
  }
}
