/**
 * Orphaned scanner detection for `kj doctor` (KJC-TSK-0668). After the CPU
 * storm, timed-out scans left semgrep-core processes reparented to init /
 * systemd, silently burning cores. This check finds processes of tools kj
 * governs whose parent is init (pid 1) or a systemd reaper, reports them,
 * and — strategy "prompt" — offers to kill them.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { STRATEGY } from "./types.js";

const execFileAsync = promisify(execFile);
const GOVERNED_TOOLS = new Set(["semgrep", "semgrep-core", "osv-scanner", "lighthouse"]);

/**
 * Scan the process table for governed tools whose parent is init or a
 * systemd reaper (where the kernel sends orphans). `runPs` injectable.
 */
export async function findOrphanToolProcesses(runPs = execFileAsync) {
  if (process.platform === "win32") return { supported: false, orphans: [] };
  let stdout;
  try {
    ({ stdout } = await runPs("ps", ["-eo", "pid=,ppid=,comm="]));
  } catch {
    return { supported: false, orphans: [] };
  }
  const rows = [];
  const commByPid = new Map();
  for (const line of String(stdout).split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const row = { pid: Number(m[1]), ppid: Number(m[2]), comm: m[3].trim() };
    rows.push(row);
    commByPid.set(row.pid, row.comm);
  }
  const orphans = rows.filter((r) =>
    GOVERNED_TOOLS.has(r.comm) && (r.ppid === 1 || commByPid.get(r.ppid) === "systemd")
  );
  return { supported: true, orphans };
}

function createOrphanCheck() {
  return {
    name: "tool-orphans",
    label: "Orphaned scanner processes",
    strategy: STRATEGY.PROMPT,
    describe: "Kill orphaned scanner processes left behind by interrupted runs",
    async detect({ runPs } = {}) {
      const { supported, orphans } = await findOrphanToolProcesses(runPs || execFileAsync);
      if (!supported) return { ok: true, severity: "info", detail: "orphan detection not supported on this platform" };
      if (orphans.length === 0) return { ok: true, severity: "info", detail: "no orphaned scanner processes" };
      const list = orphans.map((o) => `${o.comm}(${o.pid})`).join(", ");
      return {
        ok: false,
        severity: "warn",
        detail: `${orphans.length} orphaned scanner process(es) burning CPU: ${list}`,
        fix: `kill -9 ${orphans.map((o) => o.pid).join(" ")}`,
        extra: { orphans },
      };
    },
    async remediate({ extra, kill = process.kill } = {}) {
      let killed = 0;
      for (const o of extra?.orphans || []) {
        try {
          kill(o.pid, "SIGKILL");
          killed += 1;
        } catch { /* already gone */ }
      }
      return { fixed: killed > 0, detail: `killed ${killed} orphaned scanner process(es)` };
    },
  };
}

export function getOrphanChecks() {
  return [createOrphanCheck()];
}
