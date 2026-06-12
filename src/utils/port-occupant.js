/**
 * Detect which process is holding a TCP port. Cross-platform best-effort:
 *   - Linux/macOS: try `lsof -iTCP:PORT -sTCP:LISTEN -n -P -Fpcn` (parsable),
 *     fall back to `ss -tlnp` for Linux-only pid detection.
 *   - Windows: `netstat -ano` + `tasklist` to resolve image name.
 *
 * Returns null if the port is free or we cannot determine the occupant.
 * Never throws — designed to enrich diagnostic messages, not to gate logic.
 */

import { runCommand } from "./process.js";
import { escapeRegExp } from "./escape-regexp.js";

/**
 * @typedef {Object} PortOccupant
 * @property {number} port
 * @property {number|null} pid
 * @property {string|null} command      - process name ("karajan-sonarqube", "node", etc.)
 * @property {string} raw               - raw tool output for debugging
 */

/**
 * @param {number} port
 * @returns {Promise<PortOccupant|null>}
 */
export async function getPortOccupant(port) {
  if (process.platform === "win32") {
    return detectWindows(port);
  }
  const byLsof = await detectLsof(port);
  if (byLsof) return byLsof;
  return detectSs(port);
}

async function detectLsof(port) {
  try {
    const res = await runCommand("lsof", [
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-n",
      "-P",
      "-Fpcn",
    ]);
    if (res.exitCode !== 0 || !res.stdout.trim()) return null;
    // Format: lines starting with p<pid>, c<command>, n<name>
    const lines = res.stdout.split("\n").filter(Boolean);
    let pid = null;
    let command = null;
    for (const line of lines) {
      if (line.startsWith("p")) pid = Number(line.slice(1)) || null;
      else if (line.startsWith("c")) command = line.slice(1) || null;
    }
    return { port, pid, command, raw: res.stdout };
  } catch {
    return null;
  }
}

async function detectSs(port) {
  try {
    const res = await runCommand("ss", ["-tlnpH", `sport = :${port}`]);
    if (res.exitCode !== 0 || !res.stdout.trim()) return null;
    // Example line: LISTEN 0 511 0.0.0.0:4000 0.0.0.0:* users:(("node",pid=12345,fd=20))
    const match = res.stdout.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (!match) return null;
    return { port, pid: Number(match[2]), command: match[1], raw: res.stdout };
  } catch {
    return null;
  }
}

async function detectWindows(port) {
  try {
    const netstat = await runCommand("netstat", ["-ano"]);
    if (netstat.exitCode !== 0) return null;
    const line = netstat.stdout
      .split(/\r?\n/)
      .find((l) => l.match(new RegExp(`:${escapeRegExp(port)}\\s+.*LISTENING`)));
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[parts.length - 1]) || null;
    if (!pid) return { port, pid: null, command: null, raw: line };
    const tasklist = await runCommand("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    const command = parseTasklist(tasklist.stdout);
    return { port, pid, command, raw: `${line}\n${tasklist.stdout}` };
  } catch {
    return null;
  }
}

function parseTasklist(stdout) {
  const line = stdout.split(/\r?\n/).find(Boolean);
  if (!line) return null;
  const match = line.match(/^"([^"]+)"/);
  return match ? match[1] : null;
}
