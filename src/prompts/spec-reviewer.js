// Prompt builder for the `spec-reviewer` role (KJC-PCS-0048 PR 1).
// Mirrors src/prompts/triage.js — project-level override at
// `<projectDir>/.karajan/roles/spec-reviewer.md` is injected via `instructions`.

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT execute or plan the task. Do NOT mention Karajan.",
  "Do NOT use any MCP tools. Your only job is to audit the user's spec.",
].join(" ");

const VALID_CATEGORIES = [
  "ambiguity", "missing_scope", "missing_ac", "contradiction",
  "stack", "assumptions", "out_of_scope",
];

const SCHEMA_HINT = JSON.stringify({
  severity: "ok|info|warn|fail",
  findings: [{
    id: "F-001",
    severity: "info|warn|fail",
    category: VALID_CATEGORIES.join("|"),
    message: "concrete description",
    suggestion: "concrete sentence the user can paste",
  }],
  reasoning: "one or two sentences",
}, null, 2);

export function buildSpecReviewerPrompt({ spec, instructions } = {}) {
  const sections = [SUBAGENT_PREAMBLE];
  if (instructions) sections.push(instructions);
  sections.push(
    "You are the **Spec Reviewer** for Karajan Code.",
    `Categories (pick one per finding): ${VALID_CATEGORIES.join(", ")}.`,
    "Severity: `info` (nuance), `warn` (real gap), `fail` (unworkable). Top-level severity is the WORST of any finding (or `ok` if none).",
    "Return JSON only:",
    "```json", SCHEMA_HINT, "```",
    "## Spec to audit", "```", String(spec || "").trim(), "```",
  );
  return sections.join("\n");
}

/**
 * Build the refine prompt — used when the user picks `[r]efine`. The
 * agent must rewrite the spec to fix the listed findings, returning
 * ONLY the rewritten spec (no JSON, no preamble, no fence). The refine
 * loop will persist this verbatim as `spec-v2.md`.
 */
export function buildSpecRefinerPrompt({ originalSpec, findings, instructions } = {}) {
  const sections = [SUBAGENT_PREAMBLE];
  if (instructions) sections.push(instructions);
  const findingsBlock = (findings || []).map((f, i) => {
    const idx = i + 1;
    return `${idx}. [${f.severity}/${f.category}] ${f.message}${f.suggestion ? `\n   Fix: ${f.suggestion}` : ""}`;
  }).join("\n");
  sections.push(
    "You are now REWRITING the user's spec to fix the listed findings.",
    "Return ONLY the rewritten spec — no JSON, no preamble, no markdown fences, no commentary.",
    "Preserve the user's intent; do not invent new requirements or scope beyond the existing spec.",
    "## Original spec", "```", String(originalSpec || "").trim(), "```",
    "## Findings to address", findingsBlock || "(none — pass-through)",
    "## Rewritten spec",
  );
  return sections.join("\n");
}

export { VALID_CATEGORIES };
