/**
 * Linguistic indicator detection for HU splitting.
 *
 * Scans HU description text for patterns across 6 categories that suggest
 * the story should be split into smaller, more focused user stories.
 * Runs BEFORE the existing 6D evaluation.
 */

/**
 * Human-readable descriptions for each splitting heuristic.
 * @type {Record<string, string>}
 */
export const HEURISTIC_DESCRIPTIONS = Object.freeze({
  outputs_first: "CRUD in order: read → create → edit → delete",
  divide_by_example: "One complete flow per HU",
  extract_basic_utility: "Minimum valuable subset first, rest separate",
  simplify_outputs: "Simplest format first, complex formats later",
  base_case_first: "Happy path first, exceptions as separate HUs",
  narrow_segment: "Smallest user group first, expand later",
  dummy_to_dynamic: "Hardcoded data first, real data connection later",
  spike_separate: "Investigation HU (max 3 days) then implementation",
  crutches: "Manual step first, automation later"
});

/**
 * 6 indicator categories with their regex patterns (Spanish + English)
 * and the recommended splitting heuristic for each.
 */
export const INDICATOR_CATEGORIES = Object.freeze({
  CONJUNCIONES: {
    patterns: [/\by\b/i, /\bademás\b/i, /\btambién\b/i, /\be\b(?=\s+[aeiou])/i, /\band\b/i, /\balso\b/i],
    heuristic: "divide_by_example"
  },
  VERBOS_COMODIN: {
    patterns: [/\bgestionar\b/i, /\badministrar\b/i, /\bprocesar\b/i, /\bmanejar\b/i, /\bmanage\b/i, /\bhandle\b/i, /\bprocess\b/i],
    heuristic: "outputs_first"
  },
  SECUENCIA: {
    patterns: [/\bantes de\b/i, /\bdespués\b/i, /\bluego\b/i, /\bentonces\b/i, /\bprimero\b/i, /\bbefore\b/i, /\bafter\b/i, /\bthen\b/i, /\bfirst\b/i],
    heuristic: "divide_by_example"
  },
  ALCANCE_EXPANDIDO: {
    patterns: [/\bincluyendo\b/i, /\bentre otros\b/i, /\bcon soporte para\b/i, /\basí como\b/i, /\bincluding\b/i, /\bamong others\b/i, /\bwith support for\b/i],
    heuristic: "extract_basic_utility"
  },
  OPCIONALIDAD: {
    patterns: [/\bo bien\b/i, /\bopcionalmente\b/i, /\balternativamente\b/i, /\ben caso de querer\b/i, /\boptionally\b/i, /\balternatively\b/i],
    heuristic: "simplify_outputs"
  },
  EXCEPCIONES: {
    patterns: [/\bexcepto\b/i, /\ba menos que\b/i, /\bsin embargo\b/i, /\bsalvo\b/i, /\bexcept\b/i, /\bunless\b/i, /\bhowever\b/i],
    heuristic: "base_case_first"
  }
});

/**
 * Priority order for heuristic selection (highest priority first).
 * @type {string[]}
 */
const CATEGORY_PRIORITY = [
  "VERBOS_COMODIN",
  "EXCEPCIONES",
  "SECUENCIA",
  "ALCANCE_EXPANDIDO",
  "OPCIONALIDAD",
  "CONJUNCIONES"
];

/**
 * Scan HU description text against all 6 indicator categories.
 *
 * @param {string} huText - The HU description text to scan.
 * @returns {{ detected: boolean, indicators: Array<{ category: string, matchedPattern: string, heuristic: string }> }}
 */
export function detectIndicators(huText) {
  if (!huText || typeof huText !== "string") {
    return { detected: false, indicators: [] };
  }

  const indicators = [];

  for (const [category, { patterns, heuristic }] of Object.entries(INDICATOR_CATEGORIES)) {
    for (const pattern of patterns) {
      const match = pattern.exec(huText);
      if (match) {
        indicators.push({
          category,
          matchedPattern: match[0],
          heuristic
        });
        break; // one match per category is enough
      }
    }
  }

  return {
    detected: indicators.length > 0,
    indicators
  };
}

/**
 * Given detected indicators, select the primary heuristic to apply.
 * Priority: VERBOS_COMODIN > EXCEPCIONES > SECUENCIA > ALCANCE_EXPANDIDO > OPCIONALIDAD > CONJUNCIONES.
 *
 * @param {Array<{ category: string, matchedPattern: string, heuristic: string }>} indicators
 * @returns {{ heuristic: string, reason: string }}
 */
export function selectHeuristic(indicators) {
  if (!Array.isArray(indicators) || indicators.length === 0) {
    return { heuristic: "divide_by_example", reason: "No indicators detected, using default heuristic" };
  }

  const categorySet = new Set(indicators.map(ind => ind.category));

  for (const category of CATEGORY_PRIORITY) {
    if (categorySet.has(category)) {
      const indicator = indicators.find(ind => ind.category === category);
      const { heuristic } = INDICATOR_CATEGORIES[category];
      return {
        heuristic,
        reason: `Category ${category} detected (pattern: "${indicator.matchedPattern}") — ${HEURISTIC_DESCRIPTIONS[heuristic]}`
      };
    }
  }

  // Fallback (should not happen if CATEGORY_PRIORITY covers all categories)
  const first = indicators[0];
  return {
    heuristic: first.heuristic,
    reason: `Fallback to first detected category ${first.category}`
  };
}
