/**
 * KJC-TSK-1344 — where each CLI keeps its account. One person may hold two
 * subscriptions per CLI (personal and work): claude switches account with
 * CLAUDE_CONFIG_DIR and codex with CODEX_HOME. kj passes both to the agents
 * (role-env allows CLAUDE* and CODEX*), so it must also LOOK there for the
 * session and the config, never at a fixed ~/.codex or ~/.claude.json.
 */
import os from "node:os";
import path from "node:path";

const ACCOUNT_VAR = { codex: "CODEX_HOME", claude: "CLAUDE_CONFIG_DIR" };

export const codexHome = ({ home = os.homedir(), env = process.env } = {}) =>
  env.CODEX_HOME || path.join(home, ".codex");

export const claudeConfigFile = ({ home = os.homedir(), env = process.env } = {}) =>
  path.join(env.CLAUDE_CONFIG_DIR || home, ".claude.json");

/** Absolute files that mark a logged-in session, or null for agents without an account variable. */
export function agentAuthFiles(agent, { home = os.homedir(), env = process.env } = {}) {
  if (agent === "codex") return [path.join(codexHome({ home, env }), "auth.json")];
  if (agent === "claude") {
    const dir = env.CLAUDE_CONFIG_DIR;
    return dir ? [path.join(dir, ".claude.json"), path.join(dir, ".credentials.json")] : [path.join(home, ".claude.json"), path.join(home, ".claude")];
  }
  return null;
}

/** "CODEX_HOME=/path" when the variable moves the account, null on the default. */
export function accountLabel(agent, { env = process.env } = {}) {
  const name = ACCOUNT_VAR[agent];
  return name && env[name] ? `${name}=${env[name]}` : null;
}
