import { detectSpecSections } from "../plan/spec-detector.js";

function extractStepText(line) {
  const numberedStep = /^\d+[).:-]\s*(.+)$/.exec(line);
  if (numberedStep) return numberedStep[1].trim();
  const bulletStep = /^[-*]\s+(.+)$/.exec(line);
  if (bulletStep) return bulletStep[1].trim();
  return null;
}

function classifyLine(line, state) {
  if (!state.title) {
    const titleMatch = /^title\s*:\s*(.+)$/i.exec(line);
    if (titleMatch) return { type: "title", value: titleMatch[1].trim() };
  }
  if (!state.approach) {
    const approachMatch = /^(approach|strategy)\s*:\s*(.+)$/i.exec(line);
    if (approachMatch) return { type: "approach", value: approachMatch[2].trim() };
  }
  const stepText = extractStepText(line);
  if (stepText) return { type: "step", value: stepText };
  return null;
}

export function parsePlannerOutput(output) {
  const text = String(output || "").trim();
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const state = { title: null, approach: null };
  const steps = [];

  for (const line of lines) {
    const classified = classifyLine(line, state);
    if (!classified) continue;
    if (classified.type === "title") state.title = classified.value;
    else if (classified.type === "approach") state.approach = classified.value;
    else if (classified.type === "step") steps.push(classified.value);
  }

  if (!state.title) {
    const firstFreeLine = lines.find((line) => !/^(approach|strategy)\s*:/i.test(line) && !/^\d+[).:-]\s*/.test(line));
    state.title = firstFreeLine || null;
  }

  return { title: state.title, approach: state.approach, steps };
}

/**
 * KJC-BUG-0042 / P1: extract explicit scope exclusions from the task.
 *
 * The planner consistently produced HUs for items the user explicitly
 * excluded ("NO incluye en este plan: vistas compartidas, …"). Once
 * these phrases land in the task text, the LLM still generated steps
 * for them — the rule was implicit, never made FORBIDDEN. This function
 * harvests them so the prompt can echo them back literally.
 *
 * Detected patterns (inline comma-separated lists, case-insensitive):
 *   - "NO incluye[...]: a, b, c"           (Spanish)
 *   - "Fuera de(l) scope[...]: a, b, c"
 *   - "Out of scope[...]: a, b, c"          (English)
 *   - "Not in (this) plan[...]: a, b, c"
 *   - "Plan N handles: a, b, c"             (cross-plan reference)
 *   - "Reserved for plan[...]: a, b, c"
 *
 * @param {string} task
 * @returns {string[]} deduplicated trimmed exclusion items
 */
export function extractScopeExclusions(task) {
  if (!task || typeof task !== "string") return [];
  const patterns = [
    /\bNO\s+incluye[^:\n]{0,60}:\s*([^.\n]+)/gi,
    /\bFuera\s+de(?:l)?\s+scope[^:\n]{0,60}:\s*([^.\n]+)/gi,
    /\bOut\s+of\s+scope[^:\n]{0,60}:\s*([^.\n]+)/gi,
    /\bNot\s+in\s+(?:this\s+)?plan[^:\n]{0,60}:\s*([^.\n]+)/gi,
    /\bPlan\s+\d+\s+handles[^:\n]{0,60}:?\s*([^.\n]+)/gi,
    /\bReserved\s+for\s+plan[^:\n]{0,60}:\s*([^.\n]+)/gi,
  ];
  const items = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(task)) !== null) {
      const list = m[1] || "";
      for (const raw of list.split(/,|;| y |\sand\s/)) {
        const item = raw.trim().replace(/^[-*]\s*/, "").replace(/\.$/, "");
        if (item && item.length < 120) items.add(item);
      }
    }
  }
  return Array.from(items);
}

function renderScopeExclusions(exclusions) {
  if (!exclusions || exclusions.length === 0) return null;
  const list = exclusions.map((e) => `  - ${e}`).join("\n");
  return [
    "## FORBIDDEN scope (out-of-scope items declared in the task)",
    "The task explicitly excludes the following from this plan. Do NOT generate steps that implement them. If a step would touch any of these, drop it and put the item in `outOfScope` instead:",
    "",
    list,
  ].join("\n");
}

function formatArchitectContext(architectContext) {
  if (!architectContext) return null;
  const arch = architectContext.architecture || {};
  const lines = ["## Architecture Context"];

  if (arch.type) lines.push(`**Type:** ${arch.type}`);
  if (arch.layers?.length) lines.push(`**Layers:** ${arch.layers.join(", ")}`);
  if (arch.patterns?.length) lines.push(`**Patterns:** ${arch.patterns.join(", ")}`);
  if (arch.dataModel?.entities?.length) lines.push(`**Data model entities:** ${arch.dataModel.entities.join(", ")}`);
  if (arch.apiContracts?.length) lines.push(`**API contracts:** ${arch.apiContracts.join(", ")}`);
  if (arch.tradeoffs?.length) lines.push(`**Tradeoffs:** ${arch.tradeoffs.join(", ")}`);
  if (architectContext.summary) lines.push(`**Summary:** ${architectContext.summary}`);

  return lines.length > 1 ? lines.join("\n") : null;
}

/**
 * Render the SPEC-section guidance block for the planner.
 *
 * Two modes:
 *   • the task contains numbered headings (`## 1.`, `### 2.1`, `§5`) →
 *     spec_section becomes a HARD requirement and the detected
 *     sections are echoed back as a checklist. LLMs (Sonnet, Codex)
 *     consistently skipped the soft "preferred" wording, so the only
 *     reliable lever is to (a) escalate the rule to MUST and (b) hand
 *     them the literal list of section refs they're allowed to cite.
 *   • no numbered headings detected → spec_section stays optional
 *     and the prompt simply explains the field for completeness.
 */
function renderSpecSectionRules(specInfo) {
  if (!specInfo.hasSpec) {
    return [
      "### `spec_section` (optional)",
      "The task does not look like a structured SPEC, so this field may be `null`. If you do cite a section, use a short ref like `\"5.3\"` or `\"§5 Initial Scope\"`.",
    ].join("\n");
  }
  const checklist = specInfo.sectionList
    .map(({ section, title }) => `  - "${section}" — ${title}`)
    .join("\n");
  return [
    "### `spec_section` (REQUIRED — the task is a structured SPEC)",
    `Detected ${specInfo.sections.length} numbered SPEC heading(s) in the task. Every \`step\` MUST set \`spec_section\` to one of the refs below — string, exactly as listed. NEVER \`null\`, NEVER omitted, NEVER a free-form paraphrase.`,
    "",
    "Allowed values:",
    checklist,
    "",
    "If a step covers multiple sections, pick the most specific one (e.g. prefer `\"2.1\"` over `\"2\"`). If a step does not map to any section, refactor the step so it does — the SPEC is the source of truth for what work belongs in this plan.",
  ].join("\n");
}

/**
 * Render the acceptance_tests guidance block — same contract as
 * planner-role.js (the orchestrator path) so both entry points
 * produce comparable plans.
 */
function renderAcceptanceTestsRules() {
  return [
    "### `acceptance_tests` (REQUIRED — at least one test per step)",
    "Each step MUST include 2-4 executable tests. Mix `gherkin` (observable behaviour) and `shell` (concrete commands that exit 0).",
    "",
    "Shape:",
    "```json",
    '"acceptance_tests": [',
    '  { "type": "gherkin", "content": "Given <ctx>\\nWhen <action>\\nThen <outcome>" },',
    '  { "type": "shell",   "content": "<bash command that exits 0 on success>" }',
    "]",
    "```",
    "",
    "Rules:",
    "- Tests are written BEFORE the step is implemented — they should fail until the step is done, pass afterwards.",
    "- Cover at least one happy path and one edge case / failure mode.",
    "- Do NOT use the placeholder `\"npx vitest run\"` — every test must assert something specific to the step.",
  ].join("\n");
}

export function buildPlannerPrompt({ task, context, architectContext, productContext = null, domainContext = null }) {
  const specInfo = detectSpecSections(task);

  const parts = [
    "You are an expert software architect. Create an implementation plan for the following task.",
    "",
    "## Task",
    task,
    ""
  ];

  if (productContext) {
    parts.push("## Product Context", productContext, "");
  }

  if (domainContext) {
    parts.push("## Domain Context", domainContext, "");
  }

  if (context) {
    parts.push("## Context", context, "");
  }

  const exclusions = extractScopeExclusions(task);
  const exclusionsSection = renderScopeExclusions(exclusions);
  if (exclusionsSection) {
    parts.push(exclusionsSection, "");
  }

  const archSection = formatArchitectContext(architectContext);
  if (archSection) {
    parts.push(archSection, "");
  }

  parts.push(
    "## Output format",
    "Respond with a JSON object containing:",
    "- `approach`: A concise paragraph describing the overall strategy.",
    "- `steps`: An array of step objects (see shape below). Each step = one commit.",
    "- `risks`: An array of strings describing potential risks or challenges.",
    "- `outOfScope`: An array of strings listing what is explicitly NOT included.",
    "",
    "Each step in `steps` has this shape:",
    "```json",
    "{",
    '  "id": "<short symbolic identifier you choose for this step, e.g. \'INFRA-001\' or \'AUTH-SIGNUP\'>",',
    '  "description": "<what this step achieves, one sentence>",',
    '  "commit": "<conventional commit message>",',
    '  "spec_section": "<see rules below>",',
    '  "acceptance_tests": [ /* see rules below */ ],',
    '  "dependencies": [ "<symbolic ids of OTHER steps this one waits for>" ]',
    "}",
    "```",
    "",
    "### `id` (REQUIRED for cross-references)",
    "- A short symbolic identifier you assign to this step (e.g. `INFRA-001`, `AUTH-SIGNUP`, `team-list-page`).",
    "- It only has to be unique within this plan; the system maps it to a stable internal HU id afterwards.",
    "- If the user spec already prefixes its bullets with `[INFRA-001]`, `[AUTH-005]`, etc., REUSE those exact strings as `id`.",
    "",
    "### `dependencies` (REQUIRED — empty array if none)",
    "- The list of `id`s of OTHER steps in this same plan that MUST be completed before this one starts.",
    "- Read the user's spec carefully: phrases like `Depende: X, Y`, `requires X`, `after X`, `blocked by X`, `needs X first` MUST be translated into entries here.",
    "- If the spec says `Sin deps` or makes no mention of dependencies for a step, return `[]`. Do NOT invent dependencies. Do NOT chain steps by their order of appearance.",
    "- Only reference `id`s that exist among the steps you are emitting in THIS response. External or vague references (e.g. `\"the design system\"`) belong in `risks`, not `dependencies`.",
    "",
    renderSpecSectionRules(specInfo),
    "",
    renderAcceptanceTestsRules(),
    "",
    "Respond ONLY with valid JSON, no markdown fences or extra text."
  );

  return parts.join("\n");
}
