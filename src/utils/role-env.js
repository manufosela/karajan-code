/**
 * role-env — env allowlist for agent subprocesses (KJC-TSK-0693).
 *
 * Agents inherit only what their function requires: system essentials, the
 * spawned CLI's own auth/config vars, and KJ_* lane vars. Long-lived secrets
 * that no agent needs (cloud keys, registry tokens, DB URLs) never reach the
 * child, so a compromised agent or an injected prompt cannot exfiltrate them.
 * Escapes: `security.env_passthrough` (exact names or trailing-* globs) and
 * `security.env_allowlist: false` to disable filtering entirely.
 */

const EXACT = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "COLORTERM", "LANG",
  "TZ", "TMPDIR", "TMP", "TEMP", "EDITOR", "CI", "OLLAMA_HOST",
  // SSH agent socket: local-only handle, needed for git fetch/pull over SSH
  // inside worktrees. Unusable off-machine, unlike a long-lived token.
  "SSH_AUTH_SOCK", "SSH_AGENT_PID",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "no_proxy",
]);

// Per-CLI auth/config families. GOOGLE_ covers GOOGLE_APPLICATION_CREDENTIALS
// (gemini via Vertex); npm_ covers npm_config_* that Node tooling reads.
const PREFIXES = [
  "LC_", "XDG_", "KJ_", "NODE_", "npm_",
  "ANTHROPIC_", "CLAUDE", "OPENAI_", "CODEX", "GEMINI", "GOOGLE_",
  "QWEN", "DASHSCOPE_", "OPENCODE", "AIDER_", "OPENROUTER_",
];

// Vars only ONE agent authenticates with — granting them globally would
// defeat the point (the coder does not need your GitHub token; copilot does).
const AGENT_EXTRAS = {
  copilot: ["GITHUB_", "GH_"],
};

const matches = (pattern, key) =>
  pattern.endsWith("*") ? key.startsWith(pattern.slice(0, -1)) : key === pattern;

/**
 * Filter an environment down to what the given agent's subprocess needs.
 * @param {Record<string,string|undefined>} base - env to filter
 * @param {{agent?: string|null, passthrough?: string[]}} [opts]
 * @returns {Record<string,string|undefined>}
 */
export function buildAgentEnv(base = process.env, { agent = null, passthrough = [] } = {}) {
  const prefixes = [...PREFIXES, ...(AGENT_EXTRAS[agent] || [])];
  const out = {};
  for (const [key, value] of Object.entries(base)) {
    if (EXACT.has(key) || prefixes.some((p) => key.startsWith(p)) || passthrough.some((p) => matches(p, key))) {
      out[key] = value;
    }
  }
  return out;
}
