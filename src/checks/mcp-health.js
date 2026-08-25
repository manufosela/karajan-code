/**
 * MCP server health checks.
 *
 * Karajan integrates with several MCP servers — karajan-mcp (stdio), Serena,
 * Sonar MCP, Planning Game MCP, etc. This module verifies they respond to
 * a minimal JSON-RPC `initialize` call within a short deadline.
 *
 * For stdio MCPs that Karajan spawns itself (karajan-mcp), a failed ping is
 * auto-remediable by re-spawning. External MCPs (Serena) are warn-only.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { STRATEGY } from "./types.js";
import { withTimeout, TimeoutError } from "../utils/with-timeout.js";
import { checkBinary } from "../utils/agent-detect.js";

const PING_TIMEOUT_MS = 3000;

/**
 * Send a JSON-RPC `initialize` to an MCP server over stdio and wait for
 * any response. Kills the process immediately after.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
async function pingMcpStdio(command, args) {
  const handshake = () =>
    new Promise((resolve) => {
      let child;
      try {
        child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
      } catch (err) {
        resolve({ ok: false, detail: `spawn failed: ${err.message}` });
        return;
      }
      let settled = false;
      const finish = (ok, detail) => {
        if (settled) return;
        settled = true;
        try {
          child.kill();
        } catch { /* already exited */ }
        resolve({ ok, detail });
      };
      child.on("error", (err) => finish(false, `process error: ${err.message}`));
      child.on("exit", (code) => {
        if (!settled) finish(false, `exited with code ${code} before response`);
      });
      child.stdout.on("data", (buf) => {
        const text = buf.toString();
        // Any JSON-RPC response line counts as alive.
        if (text.includes("\"jsonrpc\"") || text.includes("\"result\"") || text.includes("\"error\"")) {
          finish(true, "Responded to initialize");
        }
      });
      // Send initialize request
      const req = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          clientInfo: { name: "kj-doctor", version: "1.0.0" },
          capabilities: {},
        },
      });
      try {
        child.stdin.write(req + "\n");
      } catch (err) {
        finish(false, `stdin write failed: ${err.message}`);
      }
    });
  try {
    return await withTimeout(handshake(), PING_TIMEOUT_MS, "mcp-ping");
  } catch (err) {
    if (err instanceof TimeoutError) {
      return { ok: false, detail: `No response within ${PING_TIMEOUT_MS}ms` };
    }
    return { ok: false, detail: err.message };
  }
}

/**
 * karajan-mcp health — stdio server bundled with this package.
 * Strategy: auto (we can re-spawn it ourselves).
 *
 * @internal Exported for dynamic import from tests/checks/mcp-health.test.js.
 * Knip false positive.
 */
export function createKarajanMcpCheck() {
  return {
    name: "mcp:karajan",
    label: "MCP: karajan-mcp",
    strategy: STRATEGY.AUTO,
    describe: "Respawn karajan-mcp stdio process",
    async detect() {
      const binPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/karajan-mcp.js");
      const result = await pingMcpStdio(process.execPath, [binPath]);
      return {
        ok: result.ok,
        severity: result.ok ? "info" : "warn",
        // KJC-BUG-0118: the MCP is OPTIONAL in the v4 environment (the host
        // agent drives kj via CLI) — a dead MCP must read as a degraded
        // optional, never as a broken install. The standalone (curl) binary
        // cannot run it at all (no bundled native modules).
        detail: result.ok
          ? result.detail
          : `karajan-mcp did not respond: ${result.detail} — OPTIONAL in v4: your agent runs kj directly; only shell-less hosts need MCP`,
        fix: result.ok ? undefined : "Only if you need MCP: install via npm (`npm i -g @karajan-family/code`) — the standalone binary does not bundle it",
        extra: { binPath },
      };
    },
    async remediate({ extra }) {
      // Spawn once detached so the MCP client can pick it up for subsequent runs.
      // This is idempotent: if one instance is already listening, another will
      // coexist over a different pipe.
      try {
        spawn(process.execPath, [extra.binPath], { detached: true, stdio: "ignore" }).unref();
        return { fixed: true, detail: "Re-spawned karajan-mcp in background" };
      } catch (err) {
        return { fixed: false, detail: `Failed to respawn: ${err.message}` };
      }
    },
  };
}

/**
 * Serena MCP — external tool the user installs themselves. Warn only when
 * enabled in config. Strategy: manual (we don't manage its lifecycle).
 *
 * @internal Exported for dynamic import from tests/checks/mcp-health.test.js.
 * Knip false positive.
 */
export function createSerenaMcpCheck() {
  return {
    name: "mcp:serena",
    label: "MCP: serena",
    strategy: STRATEGY.MANUAL,
    applies: (config) => config?.serena?.enabled === true,
    async detect() {
      const bin = await checkBinary("serena");
      if (!bin.ok) {
        return {
          ok: false,
          severity: "warn",
          detail: "serena binary not on PATH",
          fix: "Install Serena: uvx --from git+https://github.com/oraios/serena serena",
        };
      }
      const result = await pingMcpStdio("serena", ["start", "--mcp"]);
      return {
        ok: result.ok,
        severity: result.ok ? "info" : "warn",
        detail: result.ok ? "Serena responded to initialize" : `No response: ${result.detail}`,
        fix: result.ok ? undefined : "Restart Serena manually and verify connectivity.",
      };
    },
  };
}

/**
 * Aggregate of MCP health checks. Only enabled servers run their ping.
 */
export function getMcpHealthChecks() {
  return [createKarajanMcpCheck(), createSerenaMcpCheck()];
}
