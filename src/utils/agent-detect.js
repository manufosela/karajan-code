import { runCommand } from "./process.js";
import { resolveBin } from "../agents/resolve-bin.js";
import { getInstallCommand } from "./os-detect.js";

const KNOWN_AGENTS = [
  { name: "claude", install: getInstallCommand("claude") },
  { name: "codex", install: getInstallCommand("codex") },
  { name: "gemini", install: getInstallCommand("gemini") },
  { name: "aider", install: getInstallCommand("aider") },
  { name: "opencode", install: getInstallCommand("opencode") },
  { name: "qwen", install: getInstallCommand("qwen") },
  { name: "copilot", install: getInstallCommand("copilot") },
  // KJC-TSK-0729: promoted from the observation census once its adapter
  // landed — detecting is not supporting; supporting is.
  { name: "kimi", install: getInstallCommand("kimi") }
];

/**
 * KJC-TSK-0728 — observation census (from the Orca landscape): agent CLIs kj
 * can SEE but does not drive. Detecting is not supporting — these never feed
 * pipeline pickers; they feed the AI-surface inventory and one doctor line.
 * `bin` differs from `name` when the vendor ships an umbrella binary.
 */
const OBSERVED_AGENTS = [
  { name: "grok", bin: "grok" },
  { name: "cursor-agent", bin: "cursor-agent" },
  { name: "pi", bin: "pi" },
  { name: "kilocode", bin: "kilocode" },
  { name: "vibe", bin: "vibe" },
  { name: "rovodev", bin: "acli" },
];

/** Probe the observation census in parallel; callers filter on `available`. */
export async function detectObservedAgents() {
  return Promise.all(
    OBSERVED_AGENTS.map(async (agent) => {
      const check = await checkBinary(agent.bin);
      return { name: agent.name, bin: agent.bin, available: check.ok, version: check.ok ? check.version : null };
    })
  );
}

export async function checkBinary(name, versionArg = "--version") {
  const resolved = resolveBin(name);
  // KJC-BUG-0113: a zombie CLI that hangs on --version (seen with the
  // retired Gemini Code Assist binary) must not hang init/preflight —
  // 5s is generous for a version print.
  const res = await runCommand(resolved, [versionArg], { timeout: 5000 });
  const version = (res.stdout || res.stderr || "").split("\n")[0].trim();
  return { ok: res.exitCode === 0, version, path: resolved };
}

export async function detectAvailableAgents() {
  // PR-J (audit quick win): probe the 5 agent binaries in parallel
  // via Promise.all instead of awaiting in a for-of. checkBinary is
  // a pure shell-out (no shared state), so serialising them was
  // wasted latency. With 5 agents at ~80ms each: O(n) → O(1).
  return Promise.all(
    KNOWN_AGENTS.map(async (agent) => {
      const check = await checkBinary(agent.name);
      return {
        name: agent.name,
        available: check.ok,
        version: check.ok ? check.version : null,
        install: agent.install
      };
    })
  );
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

export { KNOWN_AGENTS, OBSERVED_AGENTS };
