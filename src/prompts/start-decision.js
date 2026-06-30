// KJC-TSK-0569 (Onboard B) — prompt + intent schema for the StartDecidor.
//
// The decider only DECIDES (one intent from a closed set); the safe HOW is
// deterministic (0570 maps the intent to a saved command). Keep this prompt
// tight: it routes, it never executes.
const PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent (the `kj start` decider).",
  "Do NOT mention Karajan, do NOT use MCP tools, do NOT execute anything.",
  "Your only job: read the project assessment and pick ONE next-step intent.",
].join(" ");

/** Closed set of intents. Anything else degrades to ASK_USER. */
export const INTENTS = new Set([
  "ASSESS_ONLY",
  "RECOMMEND_HARDEN",
  "RECOMMEND_INDEX",
  "START_TASK",
  "PROPOSE_PLAN",
  "ASK_USER",
]);

const INTENT_GUIDE = [
  "- ASSESS_ONLY: the project is healthy and the user gave no goal — just report.",
  "- RECOMMEND_HARDEN: quality gaps exist (no tests/CI, drifting checks, missing config).",
  "- RECOMMEND_INDEX: the codebase has no knowledge index yet.",
  "- START_TASK: the user stated a concrete thing to build or fix.",
  "- PROPOSE_PLAN: legacy/large project, or a goal that needs a modernization/feature plan.",
  "- ASK_USER: intent is unclear — ask ONE open question to disambiguate.",
].join("\n");

/**
 * @param {{userMessage?: string, assessment?: string, instructions?: string}} input
 * @returns {string}
 */
export function buildStartDecisionPrompt({ userMessage = "", assessment = "", instructions } = {}) {
  const sections = [PREAMBLE];
  if (instructions) sections.push(instructions);
  sections.push(
    "You route the next step for a project the user just opened with `kj start`.",
    "## Project assessment (read-only signals)",
    assessment || "(no assessment available)",
    "## User goal",
    userMessage.trim() || "(none given)",
    "## Intents",
    INTENT_GUIDE,
    "Pick the single best intent. Prefer a concrete next step over ASK_USER when the assessment is clear.",
    "If you pick ASK_USER, put the open question in questionToAsk.",
    "Return a single valid JSON object and nothing else.",
    'JSON schema: {"intent":"ASSESS_ONLY|RECOMMEND_HARDEN|RECOMMEND_INDEX|START_TASK|PROPOSE_PLAN|ASK_USER","rationale":string,"questionToAsk":string}',
  );
  return sections.join("\n\n");
}
