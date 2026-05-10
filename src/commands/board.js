import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { getKarajanHome } from "../utils/paths.js";
import { getPortOccupant } from "../utils/port-occupant.js";

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

/**
 * HTTP-probe the board's /api/dashboard. Returns true when it
 * responds with 2xx within ~750ms. Used as a fallback when the PID
 * file is missing/stale to detect "board is up, just untracked".
 */
async function isBoardReachable(port, timeoutMs = 750) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/dashboard', method: 'GET', timeout: timeoutMs },
      (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 500;
        res.resume();   // drain
        resolve(ok);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/**
 * Check if a TCP port is available on localhost.
 * Returns true when we can successfully bind (port is free).
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Starting from `desiredPort`, return the first free port within `maxTries`.
 * Returns null if none available.
 */
async function findAvailablePort(desiredPort, maxTries = 10) {
  for (let i = 0; i < maxTries; i++) {
    const port = desiredPort + i;
    if (await isPortAvailable(port)) return port;
  }
  return null;
}

/**
 * Build the board URL. When `projectSlug` is provided, the URL points at
 * the per-project view (`/p/<slug>`) so the caller's project shows up
 * pre-filtered instead of "All projects".
 * @param {number} port
 * @param {string|null} [projectSlug]
 * @returns {string}
 */
function buildBoardUrl(port, projectSlug) {
  const base = `http://localhost:${port}`;
  return projectSlug ? `${base}/p/${projectSlug}` : base;
}

export async function startBoard(desiredPort = 4000, opts = {}) {
  const { projectSlug = null, bind = "127.0.0.1" } = opts;
  const existingPid = readPid();
  if (existingPid && isProcessAlive(existingPid)) {
    // Trust the saved PID — port info comes from the PID file if present
    return {
      ok: true,
      alreadyRunning: true,
      pid: existingPid,
      url: buildBoardUrl(desiredPort, projectSlug),
    };
  }

  // Belt-and-suspenders (v2.7.5 fix): even if the PID file is missing
  // or stale, HTTP-probe the configured port before spawning. If
  // /api/dashboard responds, a board is already there — reuse it. The
  // pre-fix scenario: 🔁 self-restart didn't update the PID file
  // (now fixed), so a `kj plan` afterwards saw a stale PID, spawned
  // a duplicate board on port 4001, and confused the user.
  if (await isBoardReachable(desiredPort)) {
    return {
      ok: true,
      alreadyRunning: true,
      pid: existingPid || null,
      url: buildBoardUrl(desiredPort, projectSlug),
    };
  }

  // Find a free port starting from desiredPort
  const port = await findAvailablePort(desiredPort, 10);
  if (port === null) {
    throw new Error(`No free port in range ${desiredPort}-${desiredPort + 9}`);
  }

  const serverPath = path.join(BOARD_DIR, "src/server.js");
  const karajanHome = getKarajanHome();
  fs.mkdirSync(karajanHome, { recursive: true });

  // Open a log file for the daemon. Pre-fix the daemon was spawned
  // with `stdio: "ignore"`, so every `console.log` from server.js
  // (including the new [zombie-reaper] messages) went straight to
  // /dev/null and the user had no way to see what was happening.
  // The file is opened in append-only mode so successive starts
  // don't truncate the history.
  const logPath = path.join(karajanHome, "hu-board.log");
  const logFd = fs.openSync(logPath, "a");
  fs.writeSync(
    logFd,
    `\n--- kj board start at ${new Date().toISOString()} (port ${port}, bind ${bind}) ---\n`,
  );

  // Use process.execPath (absolute path to current node binary) instead of "node".
  // Fixes ENOENT on nvm setups where `node` is not in the spawned process's PATH.
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port), BIND_HOST: bind },
    detached: true,
    stdio: ["ignore", logFd, logFd],
    cwd: BOARD_DIR
  });
  // The parent doesn't need the fd anymore — the child inherited it.
  fs.closeSync(logFd);
  // Swallow spawn errors so an HU Board failure never crashes the pipeline.
  child.on("error", () => { /* non-blocking — caller logs via tryAutoStartBoard catch */ });
  if (!child.pid) {
    throw new Error("Failed to spawn HU Board server");
  }
  fs.writeFileSync(PID_FILE, String(child.pid));
  // Detach for real: `detached: true` only sets up the new session;
  // without `unref()` the parent's event loop still holds a reference
  // to the child handle and `kj board start` hangs at the prompt
  // instead of returning.
  child.unref();
  return {
    ok: true,
    alreadyRunning: false,
    pid: child.pid,
    url: buildBoardUrl(port, projectSlug),
    port,
    logPath,
  };
}

export async function stopBoard(opts = {}) {
  const { port = 4000 } = opts;
  // Path 1: live PID in the file → straight SIGTERM. Pre-v2.7.5
  // this was the only path; if the file was missing or stale (e.g.
  // user ran a board built before the server-writes-own-PID fix in
  // PR #508) we'd return "wasn't running" while the ghost server
  // happily kept serving requests. The fallbacks below close that gap.
  const pid = readPid();
  if (pid && isProcessAlive(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch { /* race with dying process */ }
    fs.rmSync(PID_FILE, { force: true });
    return { ok: true, wasRunning: true, pid, via: "pidfile" };
  }
  fs.rmSync(PID_FILE, { force: true });

  // Path 2: HTTP-ask the server to exit cleanly. Works for any
  // running server that has the /api/board/shutdown endpoint —
  // even when there's no PID file, no process tree to walk, etc.
  const shutdownUrl = `/api/board/shutdown`;
  const shutdownOk = await postBoardShutdown(port, shutdownUrl);
  if (shutdownOk) {
    return { ok: true, wasRunning: true, pid: null, via: "api" };
  }

  // Path 3: there's something on the port and the API didn't take it
  // down. Find its PID via lsof / ss / netstat and SIGTERM it.
  // Works against truly old servers that don't have the shutdown
  // endpoint, with the cost of one extra subprocess call.
  try {
    const occupant = await getPortOccupant(port);
    if (occupant?.pid) {
      try { process.kill(occupant.pid, "SIGTERM"); } catch { /* gone */ }
      return { ok: true, wasRunning: true, pid: occupant.pid, via: "port-occupant" };
    }
  } catch { /* lsof not installed etc — fall through */ }

  return { ok: true, wasRunning: false };
}

/**
 * Best-effort POST to the board's shutdown endpoint. Returns true
 * when the server acks (and is presumably exiting); false on any
 * error so the caller falls through to the next strategy.
 */
function postBoardShutdown(port, urlPath, timeoutMs = 750) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'POST', timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json', 'Content-Length': '2' } },
      (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 400;
        res.resume();
        resolve(ok);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write('{}');
    req.end();
  });
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

// Strip ANSI escapes so we can measure the actual on-screen width of a
// styled string. Used to size the rules around the banner content.
const ANSI_RE = /\[[0-9;]*m/g;
const visibleWidth = (s) => s.replace(ANSI_RE, "").length;

/**
 * Render a HU Board announcement framed by two horizontal rules of EQUAL
 * length. Pre-v2.7.5 we used a fixed 50-char rounded box drawn with
 * corners + verticals — fine when the URL fit, but a project slug
 * pushed past the right wall and the box looked broken. The user's
 * verdict: "looks worse than no box at all when it overflows".
 *
 * New rule: just an over-and-under rule sized to the longest visible
 * content line. No left/right verticals, no fixed width. Always tidy.
 *
 * @param {Object} params
 * @param {string} params.url           - "http://localhost:4000"
 * @param {string} params.status        - "started" | "already running"
 * @param {string} [params.projectName] - optional project label
 * @returns {string} ANSI-coloured banner ready for console.log
 */
export function renderBoardBanner({ url, status, projectName }) {
  const cyan = (s) => `[36m${s}[0m`;
  const bold = (s) => `[1m${s}[0m`;
  const underline = (s) => `[4m${s}[0m`;

  const heading = `  ${bold("HU Board")} · ${status}  →  ${underline(url)}`;
  const content = [heading];
  if (projectName) content.push(`  Project: ${bold(projectName)}`);

  // Width = widest visible content line + 2-cell padding. Cap at the
  // terminal width so a silly-long URL doesn't draw a 200-char rule.
  const termWidth = (process.stdout.columns && process.stdout.columns > 20)
    ? process.stdout.columns
    : 100;
  const longest = Math.max(...content.map(visibleWidth));
  const ruleWidth = Math.min(longest + 2, termWidth);
  const rule = cyan("─".repeat(ruleWidth));

  return ["", rule, ...content, rule, ""].join("\n");
}

export async function boardCommand({ action = "start", port = 4000, bind = "127.0.0.1", logger }) {
  switch (action) {
    case "start": {
      const result = await startBoard(port, { bind });
      if (result.alreadyRunning) {
        logger.info(`HU Board already running (PID ${result.pid}) at ${result.url}`);
      } else {
        logger.info(`HU Board started (PID ${result.pid}) at ${result.url}`);
        if (result.logPath) {
          logger.info(`Daemon logs: tail -f ${result.logPath}`);
        }
        if (bind !== "127.0.0.1" && bind !== "localhost") {
          logger.warn(`HU Board bound to ${bind} — token auth enforced for non-loopback peers. Token: ~/.karajan/hu-board/token`);
        }
      }
      return result;
    }
    case "stop": {
      const result = await stopBoard({ port });
      if (result.wasRunning) {
        const pidPart = result.pid ? ` (PID ${result.pid})` : "";
        const viaPart = result.via && result.via !== "pidfile" ? ` [via ${result.via}]` : "";
        logger.info(`HU Board stopped${pidPart}${viaPart}`);
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
      // eslint-disable-next-line import-x/no-unresolved -- optional peer; the .catch handles its absence
      const { default: open } = await import("open").catch(() => ({ default: null }));
      if (open) {
        await open(url);
        logger.info(`Opened ${url}`);
      } else {
        logger.info(`Open in browser: ${url}`);
      }
      return { ok: true, url };
    }
    case "cleanup": {
      const { initDb, closeDb, cleanupZombies } = await import("../../packages/hu-board/src/cleanup-zombies.js");
      initDb();
      try {
        const dryRun = process.argv.includes("--dry-run");
        const report = cleanupZombies({ dryRun });
        const total = report.projects.length + report.prompts.length + report.sessions.length;
        const prefix = dryRun ? "[dry-run] Would clean" : "Cleaned";
        logger.info(`${prefix}: ${report.projects.length} projects, ${report.prompts.length} prompts, ${report.sessions.length} sessions (total ${total})`);
        if (report.projects.length) logger.info(`  projects: ${report.projects.join(", ")}`);
        if (report.prompts.length)  logger.info(`  prompts:  ${report.prompts.join(", ")}`);
        if (report.sessions.length) logger.info(`  sessions: ${report.sessions.join(", ")}`);
        if (total === 0) logger.info("  Board is already clean.");
        return { ok: true, ...report };
      } finally {
        closeDb();
      }
    }
    default:
      logger.error(`Unknown board action: ${action}. Use start|stop|status|open|cleanup`);
      return { ok: false, error: `Unknown action: ${action}` };
  }
}
