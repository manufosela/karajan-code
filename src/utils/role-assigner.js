// Smart role assignment based on available AI agents.
// Used by both kj init (interactive) and auto-init (non-interactive).

import { detectAvailableAgents } from "./agent-detect.js";

// Agent capability tiers (higher = more capable for complex reasoning)
const CAPABILITY_TIERS = {
  claude: 5, // Best for reasoning, orchestration, complex tasks
  codex: 4,  // Strong coder, good reviewer
  gemini: 3, // Good general purpose
  aider: 2,  // Good coder, limited reasoning
  opencode: 2 // Similar to aider
};

// Role requirements: what capability level is ideal for each role
const ROLE_PREFERENCES = {
  brain: { minTier: 4, prefer: "claude", description: "Karajan Brain (orchestrator)" },
  solomon: { minTier: 3, prefer: "gemini", description: "Solomon (judge/arbiter)" },
  coder: { minTier: 2, prefer: "claude", description: "Coder" },
  reviewer: { minTier: 3, prefer: "codex", description: "Reviewer" },
  planner: { minTier: 4, prefer: "claude", description: "Planner" },
  researcher: { minTier: 3, prefer: "claude", description: "Researcher" },
  architect: { minTier: 4, prefer: "claude", description: "Architect" },
  tester: { minTier: 3, prefer: "claude", description: "Tester" },
  security: { minTier: 3, prefer: "claude", description: "Security" },
  triage: { minTier: 3, prefer: "claude", description: "Triage" }
};

/**
 * Assign the best available agent to a role.
 * Prefers the role's preferred agent if available, then falls back by capability tier.
 */
function assignRole(roleName, availableAgents) {
  const pref = ROLE_PREFERENCES[roleName];
  if (!pref) return availableAgents[0]?.name || "claude";

  // Preferred agent available?
  if (availableAgents.find(a => a.name === pref.prefer)) {
    return pref.prefer;
  }

  // Sort by capability tier (descending) and pick the best available
  const sorted = [...availableAgents].sort(
    (a, b) => (CAPABILITY_TIERS[b.name] || 1) - (CAPABILITY_TIERS[a.name] || 1)
  );

  return sorted[0]?.name || "claude";
}

/**
 * Try to diversify: if possible, use a different agent for reviewer than coder.
 */
function diversifyReviewer(coderAgent, availableAgents) {
  const alternatives = availableAgents.filter(a => a.name !== coderAgent);
  if (alternatives.length === 0) return coderAgent;

  const sorted = [...alternatives].sort(
    (a, b) => (CAPABILITY_TIERS[b.name] || 1) - (CAPABILITY_TIERS[a.name] || 1)
  );
  return sorted[0].name;
}

/**
 * Auto-assign all roles based on detected agents. Non-interactive.
 * Returns a config-ready object with role assignments.
 */
export async function autoAssignRoles(logger) {
  const agents = await detectAvailableAgents();
  const available = agents.filter(a => a.available);

  if (available.length === 0) {
    logger?.warn?.("No AI agents detected. Using claude as default for all roles.");
    return { assignments: getDefaultAssignments("claude"), agents, available: [] };
  }

  logger?.info?.(`Detected ${available.length} AI agent(s): ${available.map(a => `${a.name} (${a.version})`).join(", ")}`);

  const coder = assignRole("coder", available);
  const reviewer = available.length > 1 ? diversifyReviewer(coder, available) : coder;
  const brain = assignRole("brain", available);
  const solomon = available.length > 1 ? diversifyReviewer(brain, available) : brain;

  const assignments = {
    brain,
    solomon,
    coder,
    reviewer,
    planner: assignRole("planner", available),
    researcher: assignRole("researcher", available),
    architect: assignRole("architect", available),
    tester: assignRole("tester", available),
    security: assignRole("security", available),
    triage: assignRole("triage", available)
  };

  logger?.info?.(`Role assignments: Brain=${brain}, Solomon=${solomon}, Coder=${coder}, Reviewer=${reviewer}`);

  return { assignments, agents, available };
}

function getDefaultAssignments(agent) {
  return {
    brain: agent, solomon: agent, coder: agent, reviewer: agent,
    planner: agent, researcher: agent, architect: agent,
    tester: agent, security: agent, triage: agent
  };
}

/**
 * Apply role assignments to a Karajan config object.
 */
export function applyRoleAssignments(config, assignments) {
  config.coder = assignments.coder;
  config.reviewer = assignments.reviewer;

  const roleNames = ["coder", "reviewer", "planner", "researcher", "architect",
    "tester", "security", "triage", "solomon"];

  for (const role of roleNames) {
    config.roles = config.roles || {};
    config.roles[role] = config.roles[role] || {};
    config.roles[role].provider = assignments[role] || assignments.coder;
  }

  // Brain is a new top-level config (not in roles yet — will be when KarajanBrainRole is implemented)
  config.brain = { provider: assignments.brain };

  return config;
}

export { CAPABILITY_TIERS, ROLE_PREFERENCES };
