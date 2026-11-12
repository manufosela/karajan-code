import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { getKarajanHome } from "../utils/paths.js";
import { projectSlug as slugOfDir } from "../plan/plan-store.js";
import { mainCheckout } from "../utils/main-checkout.js";
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
async function isBoardReachable(port, timeoutMs = 750, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port, path: '/api/dashboard', method: 'GET', timeout: timeoutMs },
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
function isPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/**
 * Starting from `desiredPort`, return the first free port within `maxTries`.
 * Returns null if none available.
 */
async function findAvailablePort(desiredPort, maxTries = 10, host = "127.0.0.1") {
  for (let i = 0; i < maxTries; i++) {
    const port = desiredPort + i;
    if (await isPortAvailable(port, host)) return port;
  }
  return null;
}

/**
 * KJC-BUG-0498: where the board answers when bound to `bind`. On every
 * interface (0.0.0.0, ::) it answers on loopback too; bound to one address
 * (Tailscale, LAN) it answers only there, so that is where it is checked.
 */
export const probeHost = (bind) => (["0.0.0.0", "::", ""].includes(bind ?? "") ? "127.0.0.1" : bind);

/**
 * Build the board URL. KJC-TSK-0884 (ADR 0011, board scoped): with a project,
 * the scoped view `/p/<slug>`, one project with the multi-project affordances
 * hidden (app.js scoped-mode, served by the SPA fallback; checked in a browser).
 * It replaces KJC-BUG-0093's `#board/<slug>`, which kept the global dashboard.
 * @param {number} port
 * @param {string|null} [projectSlug]
 * @returns {string}
 */
export function buildBoardUrl(port, projectSlug) {
  return projectSlug ? boardUrl(port, `/p/${encodeURIComponent(projectSlug)}`) : boardUrl(port);
}

/**
 * KJC-TSK-0884: the board slug of a project is its main checkout's (#2566), even from a
 * lane or a subfolder, or the lane opens an empty view. A git failure throws, never falls back.
 */
export function boardSlug(projectDir) {
  return slugOfDir(mainCheckout(projectDir));
}

/**
 * Base board URL plus an optional absolute path (query and/or hash) —
 * `kj go` opens `/?maggle=1` so the frontend renders in plain language
 * (KJC-TSK-0810). A relative path is a caller bug, not something to fix
 * up silently.
 * @param {number} port
 * @param {string} [path]
 * @returns {string}
 */
export function boardUrl(port, path = "") {
  if (path && !path.startsWith("/")) {
    throw new Error(`board path must start with "/": ${path}`);
  }
  return `http://localhost:${port}${path}`;
}

/**
 * After spawning the board daemon, watch for an early exit. Resolves to
 * an error string when the child dies within the window — a broken
 * native module, a crash on boot, or the silent entry-point mismatch
 * that made the daemon exit 0 without a trace — and to `null` when it
 * survives. This is what stops `startBoard` from reporting `ok` for a
 * daemon that died milliseconds after spawn. The window is overridable
 * via KJ_BOARD_START_WINDOW_MS (tests set it low to stay fast).
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} logPath
 * @returns {Promise<string|null>}
 */
function diedOnStartupMessage(code, signal, logPath) {
  const how = signal ? `signal ${signal}` : `exit code ${code}`;
  return `HU Board daemon died on startup (${how}). See ${logPath} for the cause.`;
}

export function waitForEarlyExit(child, logPath) {
  const envWindow = Number(process.env.KJ_BOARD_START_WINDOW_MS);
  const windowMs = Number.isFinite(envWindow) && envWindow >= 0 ? envWindow : 1500;
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const onExit = (code, signal) => finish(diedOnStartupMessage(code, signal, logPath));
    function finish(value) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(value);
    }
    child.once("exit", onExit);
    timer = setTimeout(() => finish(null), windowMs);
  });
}

// KJC-BUG-0080: waitForEarlyExit only catches an exit, not a hung
// daemon that survived the window without ever bind()ing the port.
// Poll /api/dashboard until it answers or the readiness budget runs
// out, so we never announce "HU Board started" for an unreachable
// server. Overridable with KJ_BOARD_READY_TIMEOUT_MS (tests set it
// low to stay fast).
async function waitForBoardReachable(port, totalTimeoutMs, host = "127.0.0.1") {
  const envTimeout = Number(process.env.KJ_BOARD_READY_TIMEOUT_MS);
  const budget = Number.isFinite(envTimeout) && envTimeout >= 0
    ? envTimeout
    : (Number.isFinite(totalTimeoutMs) ? totalTimeoutMs : 5000);
  const intervalMs = budget <= 200 ? Math.max(10, Math.floor(budget / 5)) : 200;
  const deadline = Date.now() + budget;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const probeTimeout = Math.min(750, Math.max(50, remaining));
    if (await isBoardReachable(port, probeTimeout, host)) return true;
    const wait = Math.min(intervalMs, deadline - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  return false;
}

// HU-4115: the board reads every plan before it listens, so a big
// project can take far longer than the first budget. While the process
// is alive, keep probing up to a longer ceiling (KJ_BOARD_BOOT_TIMEOUT_MS,
// default 120 s). An exit while waiting throws the early-exit message.
// Resolves to { reachable, waitedMs }.
async function waitForBoardBoot(port, host, child, logPath, logger) {
  const envCeiling = Number(process.env.KJ_BOARD_BOOT_TIMEOUT_MS);
  const ceilingMs = Number.isFinite(envCeiling) && envCeiling >= 0 ? envCeiling : 120_000;
  logger?.info(`the board is still starting (it reads every plan on boot); waiting up to ${Math.round(ceilingMs / 1000)} s…`);
  let diedMessage = null;
  const onExit = (code, signal) => { diedMessage = diedOnStartupMessage(code, signal, logPath); };
  child.once("exit", onExit);
  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < ceilingMs) {
      if (diedMessage || !isProcessAlive(child.pid)) {
        throw new Error(diedMessage ?? diedOnStartupMessage("unknown", null, logPath));
      }
      if (await isBoardReachable(port, 750, host)) return { reachable: true, waitedMs: Date.now() - startedAt };
      await new Promise((r) => setTimeout(r, Math.min(200, Math.max(10, ceilingMs / 5))));
    }
    return { reachable: false, waitedMs: Date.now() - startedAt };
  } finally {
    child.removeListener("exit", onExit);
  }
}

export async function startBoard(desiredPort = 4000, opts = {}) {
  const { projectSlug = null, bind = "127.0.0.1", logger } = opts;
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
  const host = probeHost(bind);
  if (await isBoardReachable(desiredPort, 750, host)) {
    return {
      ok: true,
      alreadyRunning: true,
      pid: existingPid || null,
      url: buildBoardUrl(desiredPort, projectSlug),
    };
  }

  // Find a free port starting from desiredPort
  const port = await findAvailablePort(desiredPort, 10, host);
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
  // KJ_BOARD_DAEMON=1 tells server.js to run main() regardless of how
  // its entry-point path compares — the symlink/Windows/space-in-path
  // mismatch that used to make the daemon exit 0 in total silence.
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port), BIND_HOST: bind, KJ_BOARD_DAEMON: "1" },
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
  // Don't report success blindly: a crash on boot (e.g. broken
  // better-sqlite3, or the silent entry-point mismatch) used to be
  // reported as ok:true, leaving the user with a dead board and a log
  // showing only the start line. Catch the early exit here.
  const failure = await waitForEarlyExit(child, logPath);
  if (failure) {
    throw new Error(failure);
  }
  // KJC-BUG-0080: even after a clean window, the server may have
  // failed to bind (e.g. port race vs the parent's findAvailablePort)
  // or be still booting. Probe /api/dashboard before announcing
  // success — without this the CLI used to print "HU Board started
  // at http://localhost:4000" while :4000 actually returned nothing.
  let reachable = await waitForBoardReachable(port, undefined, host);
  let waitedMs = 0;
  if (!reachable && isProcessAlive(child.pid)) {
    ({ reachable, waitedMs } = await waitForBoardBoot(port, host, child, logPath, logger));
  }
  if (!reachable) {
    const where = host === "127.0.0.1" ? "localhost" : host;
    const waited = waitedMs ? ` (waited ${Math.round(waitedMs / 1000)} s more)` : "";
    throw new Error(
      `HU Board daemon spawned (PID ${child.pid}) but did not answer on http://${where}:${port} in time${waited}. See ${logPath} for the cause.`
    );
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

  // HU-4111: paths 2 and 3 act on whatever holds the port, so first prove
  // it is a HU Board. A foreign server on :4000 is never shut down or killed.
  if (!(await isHuBoard(port))) return { ok: true, wasRunning: false };

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
 * HU-4111: true only when `port` answers GET /api/version with the board's
 * JSON shape ({ version, boot_time }). Any other server, error or timeout → false.
 */
function isHuBoard(port, timeoutMs = 750) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/version', method: 'GET', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const info = JSON.parse(body);
            resolve(res.statusCode === 200 && typeof info?.boot_time === 'string' && 'version' in info);
          } catch { resolve(false); }
        });
        res.on('error', () => resolve(false));
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
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

/**
 * Why kj must not bring a local HU Board up for this config, or null.
 * KJC-TSK-0684 (#1287): an external board is the source of truth, so no parallel
 * HU Board. KJC-BUG-0152 (#1427): a board the config disables only starts when
 * forced, so kj never does the opposite of what kj doctor reports. `stop` is never
 * refused, so a leftover daemon can always be cleaned up. `starts` says whether
 * the action brings a server up (default: only `start`); `retry` is the command
 * that forces it.
 */
export function boardRefusal(config, { action, starts = action === "start", force, retry }) {
  if (action === "stop") return null;
  if (config?.state_backend === "external") {
    const name = config?.board?.name || "an external board";
    return { level: "warn", message: `⚠ this project's board lives in ${name} (state_backend: external) — kj does not run a parallel HU Board here.` };
  }
  if (starts && !force && config?.hu_board?.enabled === false) {
    return {
      level: "error",
      message:
        `hu_board.enabled es false en kj.config.yml — no arranco el HU Board (kj doctor ya lo reporta como omitido).\n` +
        `  Para arrancarlo igualmente: ${retry}\n` +
        `  Para dejarlo activado siempre: pon hu_board.enabled: true en kj.config.yml`,
    };
  }
  return null;
}

export async function boardCommand({ action = "start", port = 4000, bind = "127.0.0.1", logger, path }) {
  switch (action) {
    case "start": {
      let result;
      try {
        result = await startBoard(port, { bind, logger });
      } catch (err) {
        // The daemon died on boot (broken native module, crash) or no
        // free port was found. Surface it cleanly — the whole point of
        // this fix is that `kj board start` never reports a phantom
        // success while leaving a dead board behind.
        logger.error(`HU Board failed to start: ${err.message}`);
        process.exitCode = 1;
        return { ok: false, error: err.message };
      }
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
      const url = boardUrl(port, path);
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
