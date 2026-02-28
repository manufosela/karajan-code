import { runCommand } from "./process.js";
import { resolveBin } from "../agents/resolve-bin.js";

const KNOWN_AGENTS = [
  { name: "claude", install: "npm install -g @anthropic-ai/claude-code" },
  { name: "codex", install: "npm install -g @openai/codex" },
  { name: "gemini", install: "npm install -g @anthropic-ai/gemini-code (or check Gemini CLI docs)" },
  { name: "aider", install: "pip install aider-chat" }
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

export { KNOWN_AGENTS };
