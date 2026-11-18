import { loadGlobalConfigFile, writeConfig, getConfigPath, getProjectConfigPath, loadProjectConfig, resolveRole } from "../config.js";
import { checkBinary, KNOWN_AGENTS } from "../utils/agent-detect.js";
import { existsSync } from "node:fs";
import path from "node:path";

// Exportados para que el --help se autoalimente de las constantes reales
// (KJC-TSK-0755, hallazgo de campo: la firma genérica obligaba a preguntar).
export const ASSIGNABLE_ROLES = [
  "coder", "reviewer", "planner", "refactorer", "triage",
  "researcher", "tester", "security", "solomon"
];

export const VALID_PROVIDERS = KNOWN_AGENTS.map((a) => a.name);

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
    const config = await loadGlobalConfigFile();
    config.roles = config.roles || {};
    config.roles[role] = config.roles[role] || {};
    config.roles[role].provider = provider;
    const configPath = getConfigPath();
    await writeConfig(configPath, config);
    return { role, provider, scope: "global", configPath };
  }

  // Session scope — write to the process-lifetime runtime-overrides store.
  // Post-v2.7.5 this store lives at the session layer
  // (src/session/runtime-overrides.js) instead of under src/mcp/, so the
  // CLI no longer reaches into the MCP layer. The store is in-memory for
  // the current process: MCP server long-lived invocations see the
  // override across tool calls, CLI short-lived invocations naturally
  // lose it at exit (that's fine — CLI users who want persistence pass
  // --global or let it fall through to the project config below).
  const { setRuntimeOverride } = await import("../session/runtime-overrides.js");
  setRuntimeOverride(role, provider);

  // Also mirror to the project config file so future CLI invocations pick
  // it up. (The in-memory store alone is useless for CLI because the
  // process exits immediately after.)
  try {
    const projectConfigPath = getProjectConfigPath();
    const projectConfig = (await loadProjectConfig()) || {};
    projectConfig.roles = projectConfig.roles || {};
    projectConfig.roles[role] = projectConfig.roles[role] || {};
    projectConfig.roles[role].provider = provider;
    await writeConfig(projectConfigPath, projectConfig);
    return { role, provider, scope: "project", configPath: projectConfigPath };
  } catch {
    // Project config not writable — still counts as a session-scope set
    // because the in-memory store got updated above.
    return { role, provider, scope: "session" };
  }
}

/** HU-4640: a set writes this project's config unless --global asks for the shared one. */
function assertWritableScope(isLocal, isGlobal) {
  if (isLocal && isGlobal) {
    throw new Error("--local and --global are exclusive: --local (the default) writes this project's .karajan/kj.config.yml, --global writes ~/.karajan/kj.config.yml");
  }
  const projectDir = path.dirname(getProjectConfigPath());
  if (!isGlobal && !existsSync(projectDir)) {
    throw new Error(`No ${projectDir} here: run kj agents set inside a project, or pass --global to change ~/.karajan/kj.config.yml`);
  }
}

export async function agentsCommand({ config, subcommand, role, provider, local: isLocal, global: isGlobal }) {
  if (subcommand === "set") {
    if (!role || !provider) {
      console.log("Usage: kj agents set <role> <provider> [--local | --global]");
      console.log(`Roles: ${ASSIGNABLE_ROLES.join(", ")}`);
      console.log(`Providers: ${VALID_PROVIDERS.join(", ")}`);
      return;
    }
    assertWritableScope(isLocal, isGlobal);
    const result = await setAgent(role, provider, { global: Boolean(isGlobal) });
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

