/**
 * Role provider/model resolution + config validation.
 *
 * `resolveRole(config, role)` returns `{ provider, model }` for a role
 * given the fully-overridden config, respecting legacy single-provider
 * shortcuts (`coder: "claude"`) and per-role overrides
 * (`roles.coder.provider`). Handles model compatibility (gemini models
 * are dropped from a claude provider, etc.) so the agent subprocess
 * never sees an incompatible `--model` flag.
 *
 * `validateConfig(config, commandName)` is the run-time guard called by
 * every CLI command before spawning agents: it asserts every required
 * role has a provider, otherwise throws with an actionable message
 * ("Set 'roles.planner.provider' or pass '--planner <name>'").
 *
 * Extracted from `src/config.js` in TSK-0332 (Oleada 2 of the v2.7.4
 * audit refactor). Public API: `resolveRole`, `validateConfig`. The
 * inference helpers are internal.
 */

/**
 * Check if a model string is compatible with an agent provider.
 * Only returns false when the model clearly belongs to a DIFFERENT family.
 * Returns true if we can't determine or if the model is ambiguous.
 *
 * KJC-BUG-0144: exported and family-based — an agent may serve another
 * family's models (agy is Google's Antigravity, gemini family), and the
 * same check now guards BaseAgent.getRoleModel so per-role defaults
 * (e.g. start's haiku) never reach a provider from another family.
 */
const AGENT_MODEL_SIGNATURES = {
  claude: ["claude", "sonnet", "opus", "haiku"],
  codex: ["o4-", "o3-", "gpt-", "codex"],
  gemini: ["gemini", "flash-"]
};

// Single-family CLIs: they only serve their own vendor's models. Agents NOT
// in this map (aider, opencode, copilot, kimi...) are multi-model hosts —
// they route to arbitrary models, so any model name is allowed there.
const AGENT_FAMILY = { claude: "claude", codex: "codex", gemini: "gemini", agy: "gemini" };

function modelFamily(model) {
  const lower = model.toLowerCase();
  for (const [family, signatures] of Object.entries(AGENT_MODEL_SIGNATURES)) {
    if (signatures.some(s => lower.includes(s))) return family;
  }
  return null;
}

export function isModelCompatible(agent, model) {
  if (!model || !agent) return true;
  const agentFamily = AGENT_FAMILY[agent];
  if (!agentFamily) return true; // multi-model host — bring your own model
  const family = modelFamily(model);
  if (!family) return true; // ambiguous/custom/local — allow it
  return family === agentFamily;
}

// Roles that inherit provider/model from the coder when not explicitly configured
const CODER_INHERITED_ROLES = new Set([
  "planner", "refactorer", "solomon", "researcher", "tester", "security",
  "impeccable", "triage", "discover", "architect", "audit",
  "hu_reviewer", "hu-reviewer",
  "spec_reviewer", "spec-reviewer",
]);

function resolveProvider(roleConfig, role, roles, legacyCoder, legacyReviewer) {
  if (roleConfig.provider) return roleConfig.provider;

  // If model has "provider/model" format (e.g. "gemini/pro"), extract the provider
  if (roleConfig.model && roleConfig.model.includes("/")) {
    const inferredProvider = roleConfig.model.split("/")[0].toLowerCase();
    if (AGENT_MODEL_SIGNATURES[inferredProvider]) return inferredProvider;
  }

  if (role === "coder") return legacyCoder;
  if (role === "reviewer") return legacyReviewer;
  if (CODER_INHERITED_ROLES.has(role)) return roles.coder?.provider || legacyCoder;
  return null;
}

function resolveModel(roleConfig, role, config) {
  if (roleConfig.model) {
    // Strip "provider/" prefix from models like "gemini/pro" → "pro"
    const model = roleConfig.model.includes("/")
      ? roleConfig.model.split("/").slice(1).join("/")
      : roleConfig.model;
    return { model, inherited: false };
  }
  if (role === "coder") return { model: config?.coder_options?.model ?? null, inherited: false };
  if (role === "reviewer") return { model: config?.reviewer_options?.model ?? null, inherited: false };
  if (CODER_INHERITED_ROLES.has(role)) {
    const model = config?.coder_options?.model ?? null;
    return { model, inherited: !!model };
  }
  return { model: null, inherited: false };
}

export function resolveRole(config, role) {
  const roles = config?.roles || {};
  const roleConfig = roles[role] || {};
  const legacyCoder = config?.coder || null;
  const legacyReviewer = config?.reviewer || null;

  const provider = resolveProvider(roleConfig, role, roles, legacyCoder, legacyReviewer);
  let { model } = resolveModel(roleConfig, role, config);

  // Drop model if incompatible with the resolved provider (inherited or explicit)
  if (provider && model && !isModelCompatible(provider, model)) {
    model = null;
  }

  return { provider, model };
}

// Pipeline roles checked when commandName is "run": [pipelineKey, roleName]
const RUN_PIPELINE_ROLES = [
  ["reviewer", "reviewer"], ["triage", "triage"], ["planner", "planner"],
  ["refactorer", "refactorer"], ["researcher", "researcher"],
  ["tester", "tester"], ["security", "security"], ["impeccable", "impeccable"]
];

// Direct command-to-role mapping for non-"run" commands
const COMMAND_ROLE_MAP = {
  discover: ["discover"],
  plan: ["planner"],
  code: ["coder"],
  review: ["reviewer"]
};

function requiredRolesFor(commandName, config) {
  if (commandName !== "run") {
    return COMMAND_ROLE_MAP[commandName] || [];
  }
  const required = ["coder"];
  for (const [pipelineKey, roleName] of RUN_PIPELINE_ROLES) {
    const pipelineEntry = config?.pipeline?.[pipelineKey];
    // reviewer defaults to enabled (only excluded if explicitly false)
    const isEnabled = pipelineKey === "reviewer"
      ? pipelineEntry?.enabled !== false
      : Boolean(pipelineEntry?.enabled);
    if (isEnabled) required.push(roleName);
  }
  return required;
}

export function validateConfig(config, commandName = "run") {
  const errors = [];
  if (!new Set(["paranoid", "strict", "standard", "relaxed", "custom"]).has(config.review_mode)) {
    errors.push(`Invalid review_mode: ${config.review_mode}`);
  }
  if (!new Set(["tdd", "standard"]).has(config.development?.methodology)) {
    errors.push(`Invalid development.methodology: ${config.development?.methodology}`);
  }

  const requiredRoles = requiredRolesFor(commandName, config);
  for (const role of requiredRoles) {
    const { provider } = resolveRole(config, role);
    if (!provider) {
      errors.push(
        `Missing provider for required role '${role}'. Set 'roles.${role}.provider' or pass '--${role} <name>'`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  return config;
}
