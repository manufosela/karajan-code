/**
 * Validates sub-HUs produced by the splitting generator against 4 mandatory criteria.
 * Uses heuristic checks (no AI calls).
 */

/** Maximum devPoints for a sub-HU to be considered completable in 3 days. */
const MAX_DEV_POINTS = 3;

/** Text length threshold — stories longer than this are likely too big for 3 days. */
const TEXT_LENGTH_THRESHOLD = 2000;

/**
 * Regex patterns that indicate a horizontal (layer-only) split — both EN and ES.
 * @type {RegExp[]}
 */
export const HORIZONTAL_PATTERNS = [
  /\bonly the (api|backend|frontend|database|ui)\b/i,
  /\bjust the (endpoint|interface|model|schema)\b/i,
  /\bsolo (el endpoint|la interfaz|el modelo|la base de datos|el backend|el frontend)\b/i,
  /\bimplementar (el|la|los) \w+ sin\b/i
];

/**
 * Patterns that indicate a sub-HU is not independently deployable.
 * @type {RegExp[]}
 */
const DEPENDENCY_PATTERNS = [
  /\bpart \d+ of \d+\b/i,
  /\bdepends on .+ being deployed first\b/i,
  /\brequires .+ to be completed before\b/i,
  /\bparte \d+ de \d+\b/i
];

/**
 * Check whether the text has a role/goal/benefit structure (independently valuable).
 * Looks for patterns like "As a <role>, I want <goal> so that <benefit>".
 * Also accepts structured objects with role/goal/benefit fields.
 * @param {object} subHU
 * @returns {boolean}
 */
function checkIndependentlyValuable(subHU) {
  // Check structured fields first
  const desc = subHU.descriptionStructured || subHU.description_structured;
  if (Array.isArray(desc) && desc.length > 0) {
    const entry = desc[0];
    if (entry.role && entry.goal && entry.benefit) return true;
  }
  if (subHU.role && subHU.goal && subHU.benefit) return true;

  // Check text for As a/I want/so that pattern
  const text = extractText(subHU);
  const hasRole = /\b(as an?|como)\b/i.test(text);
  const hasGoal = /\b(i want|quiero|i need|necesito)\b/i.test(text);
  const hasBenefit = /\b(so that|para que|in order to|de modo que)\b/i.test(text);
  return hasRole && hasGoal && hasBenefit;
}

/**
 * Check that the sub-HU does not reference sequential dependencies.
 * @param {object} subHU
 * @returns {boolean}
 */
function checkDeployableAlone(subHU) {
  const text = extractText(subHU);
  return !DEPENDENCY_PATTERNS.some(p => p.test(text));
}

/**
 * Check whether the sub-HU is completable within 3 days.
 * Uses devPoints if available, otherwise falls back to text length heuristic.
 * @param {object} subHU
 * @returns {boolean}
 */
function checkCompletableIn3Days(subHU) {
  if (typeof subHU.devPoints === "number") {
    return subHU.devPoints <= MAX_DEV_POINTS;
  }
  const text = extractText(subHU);
  return text.length <= TEXT_LENGTH_THRESHOLD;
}

/**
 * Check the sub-HU is a vertical slice (not a horizontal layer-only story).
 * @param {object} subHU
 * @returns {boolean}
 */
function checkIsVertical(subHU) {
  const text = extractText(subHU);
  return !HORIZONTAL_PATTERNS.some(p => p.test(text));
}

/**
 * Extract all relevant text from a sub-HU for pattern matching.
 * @param {object} subHU
 * @returns {string}
 */
function extractText(subHU) {
  const parts = [
    subHU.title,
    subHU.text,
    subHU.description,
    subHU.acceptanceCriteria
  ].filter(Boolean);

  // Include structured description text
  const desc = subHU.descriptionStructured || subHU.description_structured;
  if (Array.isArray(desc)) {
    for (const entry of desc) {
      if (entry.role) parts.push(entry.role);
      if (entry.goal) parts.push(entry.goal);
      if (entry.benefit) parts.push(entry.benefit);
    }
  }

  return parts.join(" ");
}

/**
 * Validate a sub-HU against 4 mandatory split criteria.
 *
 * @param {object} subHU - The sub-HU object to validate.
 * @returns {{ valid: boolean, criteria: { independently_valuable: boolean, deployable_alone: boolean, completable_in_3_days: boolean, is_vertical: boolean }, failures: string[] }}
 */
export function validateSplitCriteria(subHU) {
  const criteria = {
    independently_valuable: checkIndependentlyValuable(subHU),
    deployable_alone: checkDeployableAlone(subHU),
    completable_in_3_days: checkCompletableIn3Days(subHU),
    is_vertical: checkIsVertical(subHU)
  };

  const failures = [];
  if (!criteria.independently_valuable) failures.push("Sub-HU does not describe independent user-facing value (missing role/goal/benefit)");
  if (!criteria.deployable_alone) failures.push("Sub-HU references sequential deployment dependencies");
  if (!criteria.completable_in_3_days) failures.push("Sub-HU appears too large to complete in 3 days");
  if (!criteria.is_vertical) failures.push("Sub-HU describes a horizontal slice instead of a vertical one");

  return {
    valid: failures.length === 0,
    criteria,
    failures
  };
}
