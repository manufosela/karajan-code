// KJC-TSK-0405: dado un HU con complexity score, recomienda coder_model y
// reviewer_model. El reviewer por defecto usa el provider alternativo al
// coder (cross-provider review) para que dos cabezas distintas miren el
// código y se detecten más patrones.

const LEVELS = ["trivial", "simple", "medium", "complex"];

// Mapping complexity score numérico → nivel categórico.
// 1 → trivial, 2 → simple, 3/4 → medium, 5+ → complex.
const SCORE_TO_LEVEL = {
  1: "trivial",
  2: "simple",
  3: "medium",
  4: "medium",
  5: "complex",
};

// Defaults por provider — alineados con utils/model-selector.js DEFAULTS.
const DEFAULT_TIERS = {
  claude: { trivial: "haiku", simple: "haiku", medium: "sonnet", complex: "opus" },
  codex: { trivial: "o4-mini", simple: "o4-mini", medium: "o4-mini", complex: "o3" },
  gemini: { trivial: "gemini-2.0-flash", simple: "gemini-2.0-flash", medium: "gemini-2.5-pro", complex: "gemini-2.5-pro" },
};

// Cross-provider reviewer default: para cada coder provider, qué provider
// usa el reviewer por defecto. Idea: dos cabezas distintas miran el código.
const CROSS_PROVIDER_REVIEWER = {
  claude: "codex",
  codex: "claude",
  gemini: "claude",
};

// KJC-TSK-0405 step 2: heurística para inferir complexity desde
// task_type cuando el planner no emite un score explícito. Permite
// que el model-router asigne modelos razonables sin un triage explícito.
const TASK_TYPE_COMPLEXITY = {
  sw: "medium",
  refactor: "medium",
  "add-tests": "simple",
  infra: "trivial",
  doc: "trivial",
  spike: "complex",
  research: "complex",
  audit: "complex",
  analysis: "medium",
  "no-code": "trivial",
};

export function complexityFromTaskType(taskType) {
  return TASK_TYPE_COMPLEXITY[taskType] || "medium";
}

export function complexityToLevel(complexity) {
  if (typeof complexity === "string" && LEVELS.includes(complexity)) return complexity;
  if (typeof complexity === "number" && SCORE_TO_LEVEL[complexity]) return SCORE_TO_LEVEL[complexity];
  return "medium";
}

/**
 * @param {object} args
 * @param {string|number} args.complexity - "trivial" | "simple" | "medium" | "complex" | score 1-5
 * @param {string} args.coderProvider - "claude" | "codex" | "gemini"
 * @param {object} args.config - karajan config (lee model_routing si existe)
 * @returns {{ coder_model: string|null, coder_provider: string, reviewer_model: string|null, reviewer_provider: string }}
 */
export function recommendModelsForHu({ complexity, coderProvider, config = {} }) {
  const level = complexityToLevel(complexity);
  const routing = config.model_routing || {};
  const fixed = routing.fixed || {};

  // Merge tiers: defaults + user overrides per provider.
  const tiers = { ...DEFAULT_TIERS };
  if (routing.by_provider) {
    for (const [prov, levels] of Object.entries(routing.by_provider)) {
      tiers[prov] = { ...(tiers[prov] || {}), ...levels };
    }
  }

  const coderTier = tiers[coderProvider];
  const coderAuto = coderTier ? (coderTier[level] || null) : null;
  const coder_model = fixed.coder || coderAuto;

  const reviewer_provider = CROSS_PROVIDER_REVIEWER[coderProvider] || "claude";
  const reviewerTier = tiers[reviewer_provider];
  const reviewerAuto = reviewerTier ? (reviewerTier[level] || null) : null;
  const reviewer_model = fixed.reviewer || reviewerAuto;

  return {
    coder_model,
    coder_provider: coderProvider,
    reviewer_model,
    reviewer_provider,
  };
}
