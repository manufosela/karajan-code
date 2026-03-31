export const VALID_TASK_TYPES = new Set(["sw", "infra", "doc", "add-tests", "refactor", "audit", "analysis", "no-code"]);

export const DEFAULT_POLICIES = {
  sw:        { tdd: true,  sonar: true,  reviewer: true, testsRequired: true  },
  infra:     { tdd: false, sonar: false, reviewer: true, testsRequired: false },
  doc:       { tdd: false, sonar: false, reviewer: true, testsRequired: false },
  "add-tests": { tdd: false, sonar: true,  reviewer: true, testsRequired: true  },
  refactor:  { tdd: true,  sonar: true,  reviewer: true, testsRequired: false },
  audit:     { tdd: false, sonar: false, reviewer: false, testsRequired: false, coderRequired: false },
  analysis:  { tdd: false, sonar: false, reviewer: false, testsRequired: false, coderRequired: false },
  "no-code": { tdd: false, sonar: false, reviewer: true, testsRequired: false, coderRequired: true },
};

const FALLBACK_TYPE = "sw";

/**
 * Resolve pipeline policies for a given taskType.
 * Unknown / null / undefined taskType falls back to "sw" (conservative).
 * configOverrides optionally merges over defaults per taskType.
 */
export function resolvePolicies(taskType, configOverrides) {
  const resolvedType = VALID_TASK_TYPES.has(taskType) ? taskType : FALLBACK_TYPE;
  const base = { ...DEFAULT_POLICIES[resolvedType] };
  const overrides = configOverrides?.[resolvedType];
  if (overrides && typeof overrides === "object") {
    Object.assign(base, overrides);
  }
  return base;
}

/**
 * Resolve policies for a taskType and return a flat object with the resolved
 * taskType plus all policy flags. This is the main entry point for the
 * orchestrator to determine which pipeline stages to enable/disable.
 */
export function applyPolicies({ taskType, policies } = {}) {
  const resolvedType = VALID_TASK_TYPES.has(taskType) ? taskType : FALLBACK_TYPE;
  const resolved = resolvePolicies(taskType, policies);
  return { taskType: resolvedType, ...resolved };
}
