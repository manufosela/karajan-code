const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on evaluating HUs."
].join(" ");

const VALID_VERDICTS = new Set(["certified", "needs_rewrite", "needs_context"]);
const VALID_ANTIPATTERNS = new Set([
  "ghost_user", "swiss_army_knife", "implementation_leak",
  "moving_goalpost", "orphan_story", "invisible_dependency", "premature_optimization"
]);
const DIMENSION_KEYS = [
  "D1_jtbd_context", "D2_user_specificity", "D3_behavior_change",
  "D4_control_zone", "D5_time_constraints", "D6_survivable_experiment"
];

/**
 * Build the prompt for the HU reviewer agent.
 * @param {{stories: Array<{id: string, text: string}>, instructions: string|null, context?: string|null}} params
 * @returns {string} The assembled prompt.
 */
export function buildHuReviewerPrompt({ stories, instructions, context = null, productContext = null }) {
  const sections = [SUBAGENT_PREAMBLE];

  if (instructions) {
    sections.push(instructions);
  }

  sections.push("## Stories to Evaluate");

  for (const story of stories) {
    sections.push(`### ${story.id}\n${story.text}`);
  }

  sections.push(
    "Return a single valid JSON object and nothing else.",
    `JSON schema: {"evaluations":[{"story_id":string,"scores":{"D1_jtbd_context":number,"D2_user_specificity":number,"D3_behavior_change":number,"D4_control_zone":number,"D5_time_constraints":number,"D6_survivable_experiment":number},"total":number,"antipatterns_detected":[string],"verdict":"certified|needs_rewrite|needs_context","evaluation_notes":string,"rewritten":object|null,"certified_hu":object|null,"context_needed":object|null}],"batch_summary":{"total":number,"certified":number,"needs_rewrite":number,"needs_context":number,"consolidated_questions":string}}`
  );

  if (productContext) {
    sections.push(`## Product Context\n${productContext}`);
  }

  if (context) {
    sections.push(`## Additional Context\n${context}`);
  }

  return sections.join("\n\n");
}

/**
 * Clamp a score to 0-10 range.
 * @param {*} value
 * @returns {number}
 */
function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

/**
 * Parse and validate a single evaluation object.
 * @param {object} raw
 * @returns {object|null}
 */
function parseEvaluation(raw) {
  if (!raw || !raw.story_id || !raw.scores) return null;

  const scores = {};
  for (const key of DIMENSION_KEYS) {
    scores[key] = clampScore(raw.scores[key]);
  }

  const total = Object.values(scores).reduce((sum, v) => sum + v, 0);
  const antipatterns = (Array.isArray(raw.antipatterns_detected) ? raw.antipatterns_detected : [])
    .filter(ap => VALID_ANTIPATTERNS.has(ap));

  const rawVerdict = String(raw.verdict || "").toLowerCase();
  const verdict = VALID_VERDICTS.has(rawVerdict) ? rawVerdict : "needs_context";

  return {
    story_id: raw.story_id,
    scores,
    total,
    antipatterns_detected: antipatterns,
    verdict,
    evaluation_notes: raw.evaluation_notes || "",
    rewritten: raw.rewritten || null,
    certified_hu: raw.certified_hu || null,
    context_needed: raw.context_needed || null
  };
}

const VALID_AC_FORMATS = new Set(["gherkin", "checklist", "pre_post", "invariant"]);
const AC_PREFIX_RE = /^\[(GHERKIN|CHECKLIST|PRE_POST|INVARIANT)]\s*/i;

/**
 * Detect the format of a single acceptance criterion.
 * Supports both prefixed strings ("[GHERKIN] Given...") and legacy Gherkin objects ({given, when, then}).
 * @param {string|object} criterion
 * @returns {{format: string, text: string}}
 */
export function detectAcFormat(criterion) {
  if (typeof criterion === "object" && criterion !== null && ("given" in criterion || "when" in criterion || "then" in criterion)) {
    const text = `Given ${criterion.given || "..."}, When ${criterion.when || "..."}, Then ${criterion.then || "..."}`;
    return { format: "gherkin", text };
  }
  if (typeof criterion === "string") {
    const match = AC_PREFIX_RE.exec(criterion);
    if (match) {
      const format = match[1].toLowerCase();
      const text = criterion.slice(match[0].length);
      return { format, text };
    }
    return { format: "checklist", text: criterion };
  }
  return { format: "checklist", text: String(criterion) };
}

/**
 * Normalize an acceptance_criteria array to a uniform structure.
 * Handles both legacy Gherkin objects and prefixed strings.
 * @param {Array} criteria
 * @returns {Array<{format: string, text: string}>}
 */
export function normalizeAcceptanceCriteria(criteria) {
  if (!Array.isArray(criteria)) return [];
  return criteria.map(detectAcFormat);
}

/**
 * Parse the raw output from the HU reviewer agent.
 * @param {string} raw - Raw text output from the agent.
 * @returns {object|null} Parsed result with evaluations and batch_summary, or null.
 */
export function parseHuReviewerOutput(raw) {
  const text = raw?.trim() || "";
  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (!jsonMatch) return null;

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed.evaluations)) return null;

  const evaluations = parsed.evaluations
    .map(parseEvaluation)
    .filter(Boolean);

  if (evaluations.length === 0) return null;

  const certified = evaluations.filter(e => e.verdict === "certified").length;
  const needsRewrite = evaluations.filter(e => e.verdict === "needs_rewrite").length;
  const needsContext = evaluations.filter(e => e.verdict === "needs_context").length;

  return {
    evaluations,
    batch_summary: {
      total: evaluations.length,
      certified,
      needs_rewrite: needsRewrite,
      needs_context: needsContext,
      consolidated_questions: parsed.batch_summary?.consolidated_questions || ""
    }
  };
}
