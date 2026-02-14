import { runCommand } from "../utils/process.js";

const AGENT_META = {
  codex: { bin: "codex", installUrl: "https://developers.openai.com/codex/cli" },
  claude: { bin: "claude", installUrl: "https://docs.anthropic.com/en/docs/claude-code" },
  gemini: { bin: "gemini", installUrl: "https://github.com/google-gemini/gemini-cli" },
  aider: { bin: "aider", installUrl: "https://aider.chat/docs/install.html" }
};

export async function assertAgentsAvailable(agentNames = []) {
  const unique = [...new Set(agentNames.filter(Boolean))];
  const missing = [];

  for (const name of unique) {
    const meta = AGENT_META[name];
    if (!meta) continue;
    const res = await runCommand(meta.bin, ["--version"]);
    if (res.exitCode !== 0) {
      missing.push({ name, ...meta });
    }
  }

  if (missing.length === 0) return;

  const lines = ["Missing required AI CLIs for this command:"];
  for (const m of missing) {
    lines.push(`- ${m.name}: command '${m.bin}' not found`);
    lines.push(`  Install: ${m.installUrl}`);
  }
  throw new Error(lines.join("\n"));
}
