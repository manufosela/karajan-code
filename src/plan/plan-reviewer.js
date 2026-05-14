/**
 * Plan reviewer — third pass after `kj plan` (PR D of the v2.7.5
 * tests-first roadmap). Asks the planner LLM five concrete
 * questions about the plan it just produced. Returns structured
 * findings, NOT free-form prose.
 *
 * The questions are intentionally closed-ended:
 *
 *   1. **Missing HUs** — sections of the SPEC the plan doesn't cover.
 *      (Catches "the planner forgot module X".)
 *   2. **Missing dependencies** — pairs of HUs that should have a
 *      `blocked_by` edge but don't.
 *      (Catches "HU 4 needs the schema HU 2 produces".)
 *   3. **Scope overlap** — pairs of HUs that touch the same scope.
 *      (Catches "the planner split one piece of work into two HUs
 *      that step on each other".)
 *   4. **Parallelisable** — sets of HUs that have no inter-deps and
 *      could run side-by-side.
 *      (Surface for the user, not auto-applied — `kj run --plan`
 *      runs serially today.)
 *   5. **Order issues** — HUs whose `blocked_by` chain is wrong or
 *      circular.
 *
 * The output is purely advisory. The reviewer NEVER edits the plan.
 * It reports findings; the user decides whether to apply them via
 * the board's edit modal or another `kj plan` pass.
 *
 * Free-form "could we add logging?" suggestions are explicitly out
 * of scope to avoid scope-creep noise — see the prompt rules.
 */

import { extractFirstJson } from "../utils/json-extract.js";

/**
 * Build the focused review prompt. Exported for unit-testing the
 * shape without an LLM in the loop.
 *
 * @param {object} args
 * @param {string} args.task
 * @param {Array<object>} args.hus
 * @returns {string}
 */
export function buildReviewerPrompt({ task, hus }) {
  const huSummary = hus.map((h, i) => {
    const deps = Array.isArray(h.blocked_by) && h.blocked_by.length > 0
      ? ` ← blocked_by: ${h.blocked_by.join(", ")}`
      : "";
    const spec = h.spec_section ? ` [§${h.spec_section}]` : "";
    return `${i + 1}. ${h.id}${spec}: ${h.title || "(untitled)"}${deps}\n   scope: ${h.scope || "(none)"}`;
  }).join("\n\n");

  return [
    "You previously generated an implementation plan for the task below.",
    "Your ONLY job in this call is to review it against five specific questions.",
    "DO NOT propose new features, logging, monitoring, refactors, or anything",
    "beyond what the SPEC explicitly requires. We're checking the plan for",
    "completeness and correctness — NOT improving its scope.",
    "",
    "Output MUST be a JSON object with this exact shape:",
    "",
    "```json",
    "{",
    '  "missing_hus": [',
    '    { "spec_section": "<section ref or short description>", "rationale": "<why it should exist>" }',
    "  ],",
    '  "missing_dependencies": [',
    '    { "from": "<huId that should depend on>", "on": "<huId>", "rationale": "<why>" }',
    "  ],",
    '  "scope_overlaps": [',
    '    { "between": ["<huId>", "<huId>"], "rationale": "<why they overlap>" }',
    "  ],",
    '  "parallelisable_groups": [',
    '    { "his": ["<huId>", "<huId>"], "rationale": "<why these can run side-by-side>" }',
    "  ],",
    '  "order_issues": [',
    '    { "hus": ["<huId>"], "issue": "<wrong order | circular | other>", "rationale": "<why>" }',
    "  ],",
    '  "summary": "<one sentence overall verdict>"',
    "}",
    "```",
    "",
    "Rules:",
    "- Each array can be empty if there's nothing to flag for that question.",
    "- Reference HUs by their EXACT id from the list below.",
    "- Suggest at MOST 5 entries per array — only the most important ones.",
    "- DO NOT propose tests / acceptance criteria — those are handled by other roles.",
    "- DO NOT suggest renames / cosmetic changes — only structural issues.",
    "- Return ONLY the JSON — no prose, no markdown fences around it.",
    "",
    "## Original Task",
    task,
    "",
    "## Plan to review",
    "",
    huSummary,
    "",
  ].join("\n");
}

/**
 * Run the focused review pass.
 *
 * Pure-function side: parses the LLM JSON and normalises the shape
 * (missing arrays default to `[]`, summary defaults to `""`). Junk
 * entries (missing required fields) are dropped silently.
 *
 * @param {object} args
 * @param {object} args.agent
 * @param {string} args.task
 * @param {Array<object>} args.hus
 * @param {Function} [args.onOutput]
 * @param {number} [args.silenceTimeoutMs]
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ ok: boolean, findings?: object, error?: string }>}
 */
export async function reviewPlan({ agent, task, hus, onOutput, silenceTimeoutMs, timeoutMs }) {
  if (!Array.isArray(hus) || hus.length === 0) {
    return { ok: true, findings: emptyFindings("Plan has no HUs to review.") };
  }
  const prompt = buildReviewerPrompt({ task, hus });
  const runArgs = { prompt, role: "planner" };
  if (onOutput) runArgs.onOutput = onOutput;
  if (silenceTimeoutMs) runArgs.silenceTimeoutMs = silenceTimeoutMs;
  if (timeoutMs) runArgs.timeoutMs = timeoutMs;

  const result = await agent.runTask(runArgs);
  if (!result.ok) {
    return { ok: false, error: result.error || "reviewer agent failed" };
  }
  const parsed = extractFirstJson(result.output || "");
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "reviewer returned no JSON object" };
  }
  return { ok: true, findings: normaliseFindings(parsed) };
}

function emptyFindings(summary) {
  return {
    missing_hus: [],
    missing_dependencies: [],
    scope_overlaps: [],
    parallelisable_groups: [],
    order_issues: [],
    summary: summary || "",
  };
}

/**
 * Coerce the raw LLM payload into the canonical shape. Each list is
 * filtered to keep only entries with the required fields populated.
 * @param {object} raw
 */
function normaliseFindings(raw) {
  const f = emptyFindings(typeof raw.summary === "string" ? raw.summary : "");
  if (Array.isArray(raw.missing_hus)) {
    f.missing_hus = raw.missing_hus
      .filter((m) => m && (m.spec_section || m.section || m.title) && m.rationale)
      .map((m) => ({
        spec_section: String(m.spec_section || m.section || m.title),
        rationale: String(m.rationale),
      }));
  }
  if (Array.isArray(raw.missing_dependencies)) {
    f.missing_dependencies = raw.missing_dependencies
      .filter((d) => d && d.from && d.on && d.rationale)
      .map((d) => ({ from: String(d.from), on: String(d.on), rationale: String(d.rationale) }));
  }
  if (Array.isArray(raw.scope_overlaps)) {
    f.scope_overlaps = raw.scope_overlaps
      .filter((o) => o && Array.isArray(o.between) && o.between.length >= 2 && o.rationale)
      .map((o) => ({ between: o.between.map(String), rationale: String(o.rationale) }));
  }
  if (Array.isArray(raw.parallelisable_groups)) {
    f.parallelisable_groups = raw.parallelisable_groups
      .filter((g) => g && Array.isArray(g.hus) && g.hus.length >= 2)
      .map((g) => ({ hus: g.hus.map(String), rationale: g.rationale ? String(g.rationale) : "" }));
  }
  if (Array.isArray(raw.order_issues)) {
    f.order_issues = raw.order_issues
      .filter((o) => o && Array.isArray(o.hus) && o.hus.length >= 1 && o.issue)
      .map((o) => ({ hus: o.hus.map(String), issue: String(o.issue), rationale: o.rationale ? String(o.rationale) : "" }));
  }
  return f;
}

/**
 * Flatten findings into a count of actionable items (for the CLI
 * banner: "Reviewer found 3 issues.").
 */
export function findingsCount(findings) {
  if (!findings) return 0;
  return (
    (findings.missing_hus?.length || 0)
    + (findings.missing_dependencies?.length || 0)
    + (findings.scope_overlaps?.length || 0)
    + (findings.order_issues?.length || 0)
    // parallelisable_groups is informational, not an issue.
  );
}

/**
 * KJC-BUG-0054: count findings categorised por prioridad, para que
 * el self-fix convergence guard pueda distinguir "regresión genuina"
 * de "regresión por arreglar algo importante".
 *
 * Categorías:
 *   - priority: ciclos (order_issues con issue=='circular') + missing_hus.
 *     Estos NO pueden ignorarse — un ciclo deja el plan no ejecutable;
 *     una HU faltante es feature missing.
 *   - secondary: missing_dependencies + scope_overlaps + order_issues
 *     no-circulares. Importantes pero recuperables.
 *
 * @param {object} findings
 * @returns {{ priority: number, secondary: number, total: number, cycles: number }}
 */
export function findingsCountByType(findings) {
  if (!findings) return { priority: 0, secondary: 0, total: 0, cycles: 0 };
  const orderIssues = findings.order_issues || [];
  const cycles = orderIssues.filter(
    (i) => i && typeof i === "object" && i.issue === "circular"
  ).length;
  const orderNonCircular = orderIssues.length - cycles;
  const missingHus = findings.missing_hus?.length || 0;
  const missingDeps = findings.missing_dependencies?.length || 0;
  const overlaps = findings.scope_overlaps?.length || 0;
  const priority = cycles + missingHus;
  const secondary = missingDeps + overlaps + orderNonCircular;
  return { priority, secondary, total: priority + secondary, cycles };
}
