/**
 * Heuristic-based HU splitting detection.
 * Analyzes user story text for indicators that suggest the HU should be split.
 */

/**
 * @typedef {object} SplitIndicator
 * @property {string} type - Indicator type (e.g. "multiple_and", "multiple_roles")
 * @property {string} detail - Human-readable description of what was detected
 * @property {number} weight - How strongly this indicator suggests splitting (1-3)
 */

/** @type {Record<string, string>} */
export const HEURISTIC_DESCRIPTIONS = Object.freeze({
  workflow_steps: "Split by workflow steps: each step of the user journey becomes its own HU.",
  data_entity: "Split by data entity: each distinct entity (model, resource) gets its own HU.",
  user_role: "Split by user role: each actor/persona gets their own HU.",
  crud_operations: "Split by CRUD operations: separate create, read, update, delete into individual HUs.",
  happy_sad_path: "Split by happy/sad path: main flow in one HU, error/edge cases in another.",
  interface_boundary: "Split by interface boundary: frontend, backend, integration each get their own HU."
});

const HEURISTIC_KEYS = Object.keys(HEURISTIC_DESCRIPTIONS);

/**
 * Detect indicators in HU text that suggest the story should be split.
 * @param {string} text - The HU text to analyze.
 * @returns {SplitIndicator[]} Array of detected indicators (empty if no splitting needed).
 */
export function detectIndicators(text) {
  if (!text || typeof text !== "string") return [];

  const indicators = [];
  const lower = text.toLowerCase();

  // Multiple "and" connectors suggest compound story
  const andMatches = lower.match(/\band\b/g);
  if (andMatches && andMatches.length >= 2) {
    indicators.push({
      type: "multiple_and",
      detail: `Found ${andMatches.length} "and" connectors suggesting compound story`,
      weight: 2
    });
  }

  // Multiple roles mentioned
  const rolePatterns = /\bas (?:a |an )?(\w+)/gi;
  const roles = [...text.matchAll(rolePatterns)].map(m => m[1].toLowerCase());
  const uniqueRoles = new Set(roles);
  if (uniqueRoles.size > 1) {
    indicators.push({
      type: "multiple_roles",
      detail: `Multiple roles detected: ${[...uniqueRoles].join(", ")}`,
      weight: 3
    });
  }

  // Multiple acceptance criteria groups or numbered lists
  const acCount = (text.match(/^[-*\d+.]\s/gm) || []).length;
  if (acCount > 5) {
    indicators.push({
      type: "many_acceptance_criteria",
      detail: `${acCount} acceptance criteria items detected`,
      weight: 2
    });
  }

  // CRUD keywords
  const crudKeywords = ["create", "read", "update", "delete", "edit", "remove", "list", "view"];
  const foundCrud = crudKeywords.filter(kw => lower.includes(kw));
  if (foundCrud.length >= 3) {
    indicators.push({
      type: "crud_operations",
      detail: `Multiple CRUD operations: ${foundCrud.join(", ")}`,
      weight: 2
    });
  }

  // Multiple "so that" / "in order to" benefits
  const benefitMatches = lower.match(/\b(so that|in order to)\b/g);
  if (benefitMatches && benefitMatches.length > 1) {
    indicators.push({
      type: "multiple_benefits",
      detail: `${benefitMatches.length} benefit clauses detected`,
      weight: 2
    });
  }

  // Workflow/step keywords
  const stepKeywords = ["first", "then", "after that", "finally", "next", "step"];
  const foundSteps = stepKeywords.filter(kw => lower.includes(kw));
  if (foundSteps.length >= 2) {
    indicators.push({
      type: "workflow_steps",
      detail: `Sequential workflow indicators: ${foundSteps.join(", ")}`,
      weight: 2
    });
  }

  return indicators;
}

/**
 * Select the best splitting heuristic based on detected indicators.
 * @param {SplitIndicator[]} indicators - Detected split indicators.
 * @param {string[]} [excludeHeuristics=[]] - Heuristics to skip (already tried).
 * @returns {string|null} The selected heuristic key, or null if none applicable.
 */
export function selectHeuristic(indicators, excludeHeuristics = []) {
  if (!indicators || indicators.length === 0) return null;

  const excluded = new Set(excludeHeuristics);

  // Map indicator types to preferred heuristics
  const heuristicScores = {};
  for (const key of HEURISTIC_KEYS) {
    if (!excluded.has(key)) {
      heuristicScores[key] = 0;
    }
  }

  for (const ind of indicators) {
    switch (ind.type) {
      case "multiple_roles":
        if (!excluded.has("user_role")) heuristicScores.user_role = (heuristicScores.user_role || 0) + ind.weight;
        break;
      case "crud_operations":
        if (!excluded.has("crud_operations")) heuristicScores.crud_operations = (heuristicScores.crud_operations || 0) + ind.weight;
        break;
      case "workflow_steps":
        if (!excluded.has("workflow_steps")) heuristicScores.workflow_steps = (heuristicScores.workflow_steps || 0) + ind.weight;
        break;
      case "multiple_and":
      case "many_acceptance_criteria":
        if (!excluded.has("workflow_steps")) heuristicScores.workflow_steps = (heuristicScores.workflow_steps || 0) + ind.weight;
        if (!excluded.has("data_entity")) heuristicScores.data_entity = (heuristicScores.data_entity || 0) + ind.weight;
        break;
      case "multiple_benefits":
        if (!excluded.has("happy_sad_path")) heuristicScores.happy_sad_path = (heuristicScores.happy_sad_path || 0) + ind.weight;
        if (!excluded.has("interface_boundary")) heuristicScores.interface_boundary = (heuristicScores.interface_boundary || 0) + ind.weight;
        break;
      default:
        break;
    }
  }

  // Pick highest scoring non-excluded heuristic
  let best = null;
  let bestScore = 0;
  for (const [key, score] of Object.entries(heuristicScores)) {
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }

  return best;
}
