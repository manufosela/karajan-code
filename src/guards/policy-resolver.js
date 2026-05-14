/**
 * Policy resolution: map task type + config toggles to concrete pipeline
 * flags (TDD, Sonar, reviewer retries, tests required, coder required, ...).
 *
 * @typedef {import("../types/policy.js").ResolvedPolicies} ResolvedPolicies
 * @typedef {import("../types/config.js").KarajanConfig} KarajanConfig
 */

// KJC-TSK-0400: spike y research añadidos como tipos no-code. Comparten
// las defaults restrictivas (tdd/sonar/testsRequired off) porque NO
// producen código que medir: un SPIKE es un .md de decisión, un research
// es una nota de investigación. Forzar Sonar les hace fallar siempre.
export const VALID_TASK_TYPES = new Set([
  "sw", "infra", "doc", "add-tests", "refactor",
  "audit", "analysis", "no-code", "spike", "research",
]);

export const DEFAULT_POLICIES = {
  sw:        { tdd: true,  sonar: true,  reviewer: true, testsRequired: true  },
  infra:     { tdd: false, sonar: false, reviewer: false, testsRequired: false },
  doc:       { tdd: false, sonar: false, reviewer: true, testsRequired: false },
  "add-tests": { tdd: false, sonar: true,  reviewer: true, testsRequired: true  },
  refactor:  { tdd: true,  sonar: true,  reviewer: true, testsRequired: false },
  audit:     { tdd: false, sonar: false, reviewer: false, testsRequired: false, coderRequired: false },
  analysis:  { tdd: false, sonar: false, reviewer: false, testsRequired: false, coderRequired: false },
  "no-code": { tdd: false, sonar: false, reviewer: true, testsRequired: false, coderRequired: true },
  spike:     { tdd: false, sonar: false, reviewer: true, testsRequired: false, coderRequired: true },
  research:  { tdd: false, sonar: false, reviewer: true, testsRequired: false, coderRequired: true },
};

// KJC-TSK-0400: si el title arranca con [SPIKE] / [DOC] / [RESEARCH] /
// [NOCODE], inferimos el task_type del prefijo. Pensado para casos donde
// el planner emite task_type='sw' por defecto pero el title declara
// claramente que la HU no produce código. Devuelve null si no hay match.
const TITLE_PREFIX_TO_TYPE = {
  SPIKE: "spike",
  RESEARCH: "research",
  DOC: "doc",
  NOCODE: "no-code",
  "NO-CODE": "no-code",
};

export function inferTaskTypeFromTitle(title) {
  if (typeof title !== "string") return null;
  const m = title.match(/^\s*\[([A-Z][A-Z-]+)\]/);
  if (!m) return null;
  return TITLE_PREFIX_TO_TYPE[m[1].toUpperCase()] || null;
}

// KJC-TSK-0400: dado un HU del plan, devuelve el task_type efectivo:
// explícito en story.task_type si es válido, si no inferido del title.
// Fallback 'sw' (conservador, mantiene gates activos cuando hay duda).
export function effectiveTaskType(story) {
  if (!story || typeof story !== "object") return "sw";
  if (VALID_TASK_TYPES.has(story.task_type)) return story.task_type;
  return inferTaskTypeFromTitle(story.title) || "sw";
}

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
