import { runCommand } from "./process.js";
import { resolveBin } from "../agents/resolve-bin.js";
import { getInstallCommand } from "./os-detect.js";

const KNOWN_AGENTS = [
  { name: "claude", install: getInstallCommand("claude") },
  { name: "codex", install: getInstallCommand("codex") },
  { name: "gemini", install: getInstallCommand("gemini") },
  { name: "aider", install: getInstallCommand("aider") },
  { name: "opencode", install: getInstallCommand("opencode") }
];

export async function checkBinary(name, versionArg = "--version") {
  const resolved = resolveBin(name);
  const res = await runCommand(resolved, [versionArg]);
  const version = (res.stdout || res.stderr || "").split("\n")[0].trim();
  return { ok: res.exitCode === 0, version, path: resolved };
}

export async function detectAvailableAgents() {
  const results = [];
  for (const agent of KNOWN_AGENTS) {
    const check = await checkBinary(agent.name);
    results.push({
      name: agent.name,
      available: check.ok,
      version: check.ok ? check.version : null,
      install: agent.install
    });
  }
  return results;
}

/**
 * Detect which AI agent is the current MCP host (if any).
 * Returns the agent name ("claude", "codex", etc.) or null if not inside an agent.
 */
export function detectHostAgent() {
  if (process.env.CLAUDECODE === "1" || process.env.CLAUDE_CODE === "1") return "claude";
  if (process.env.CODEX_CLI === "1" || process.env.CODEX === "1") return "codex";
  if (process.env.GEMINI_CLI === "1") return "gemini";
  if (process.env.OPENCODE === "1") return "opencode";
  return null;
}

/**
 * Check if a given provider matches the current host agent.
 * When true, we can skip subprocess spawning and delegate to the host.
 */
export function isHostAgent(provider) {
  const host = detectHostAgent();
  return host !== null && host === provider;
}

export { KNOWN_AGENTS };
