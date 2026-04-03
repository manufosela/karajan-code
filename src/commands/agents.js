import { loadConfig, writeConfig, getConfigPath, getProjectConfigPath, loadProjectConfig, resolveRole } from "../config.js";
import { checkBinary, KNOWN_AGENTS } from "../utils/agent-detect.js";

const ASSIGNABLE_ROLES = [
  "coder", "reviewer", "planner", "refactorer", "triage",
  "researcher", "tester", "security", "solomon"
];

const VALID_PROVIDERS = KNOWN_AGENTS.map((a) => a.name);

export function listAgents(config, sessionOverrides = {}, projectConfig = null) {
  return ASSIGNABLE_ROLES.map((role) => {
    const resolved = resolveRole(config, role);
    const sessionProvider = sessionOverrides[role];
    const projectProvider = projectConfig?.roles?.[role]?.provider;
    let scope = "global";
    if (sessionProvider) scope = "session";
    else if (projectProvider) scope = "project";
    return {
      role,
      provider: sessionProvider || resolved.provider || "-",
      model: resolved.model || "-",
      scope
    };
  });
}

export async function setAgent(role, provider, { global: isGlobal = false } = {}) {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new Error(`Unknown role "${role}". Valid roles: ${ASSIGNABLE_ROLES.join(", ")}`);
  }
  if (!VALID_PROVIDERS.includes(provider)) {
    const bin = await checkBinary(provider);
    if (!bin.ok) {
      throw new Error(`Provider "${provider}" not found. Available: ${VALID_PROVIDERS.join(", ")}`);
    }
  }

  if (isGlobal) {
    const { config } = await loadConfig();
    config.roles = config.roles || {};
    config.roles[role] = config.roles[role] || {};
    config.roles[role].provider = provider;
    const configPath = getConfigPath();
    await writeConfig(configPath, config);
    return { role, provider, scope: "global", configPath };
  }

  // Session scope — try MCP session override first
  try {
    const { setSessionOverride } = await import("../mcp/preflight.js");
    setSessionOverride(role, provider);
    return { role, provider, scope: "session" };
  } catch { /* preflight module not available in CLI mode */
    // preflight module not available (CLI mode) — write to project config
    const projectConfigPath = getProjectConfigPath();
    const projectConfig = (await loadProjectConfig()) || {};
    projectConfig.roles = projectConfig.roles || {};
    projectConfig.roles[role] = projectConfig.roles[role] || {};
    projectConfig.roles[role].provider = provider;
    await writeConfig(projectConfigPath, projectConfig);
    return { role, provider, scope: "project", configPath: projectConfigPath };
  }
}

export async function agentsCommand({ config, subcommand, role, provider, global: isGlobal }) {
  if (subcommand === "set") {
    if (!role || !provider) {
      console.log("Usage: kj agents set <role> <provider> [--global]");
      console.log(`Roles: ${ASSIGNABLE_ROLES.join(", ")}`);
      console.log(`Providers: ${VALID_PROVIDERS.join(", ")}`);
      return;
    }
    const result = await setAgent(role, provider, { global: isGlobal ?? true });
    console.log(`Set ${result.role} -> ${result.provider} (scope: ${result.scope})`);
    return result;
  }

  const projectConfig = await loadProjectConfig();
  const agents = listAgents(config, {}, projectConfig);
  const roleWidth = Math.max(...agents.map((a) => a.role.length), 4);
  const provWidth = Math.max(...agents.map((a) => a.provider.length), 8);
  const scopeWidth = Math.max(...agents.map((a) => a.scope.length), 5);
  console.log(`${"Role".padEnd(roleWidth)}  ${"Provider".padEnd(provWidth)}  ${"Scope".padEnd(scopeWidth)}  Model`);
  console.log("-".repeat(roleWidth + provWidth + scopeWidth + 14));
  for (const a of agents) {
    console.log(`${a.role.padEnd(roleWidth)}  ${a.provider.padEnd(provWidth)}  ${a.scope.padEnd(scopeWidth)}  ${a.model}`);
  }
  return agents;
}

