// KJC-TSK-0987 (issue #1894): AcceptanceCoverageRole, the judge that reads each
// acceptance criterion of the card against the diff before the run is approved.
// Judged by a different AI than the coder (the reviewer's provider by default).
// Role + helpers ship here; the stage wires it (same PR), the loops next.

import { AgentRole } from "./agent-role.js";
import { buildAcceptanceCoveragePrompt } from "../prompts/acceptance-coverage.js";
import { extractFirstJson } from "../utils/json-extract.js";

/**
 * The card's acceptance criteria as plain sentences, one per criterion.
 * Structured Given/When/Then first; else the free text, one per line or bullet.
 * @param {object|null} card
 * @returns {string[]}
 */
export function criteriaOfCard(card) {
  const structured = Array.isArray(card?.acceptanceCriteriaStructured) ? card.acceptanceCriteriaStructured : [];
  const fromStructured = structured
    .map((ac) => (ac?.given && ac?.when && ac?.then ? `Given ${ac.given}, when ${ac.when}, then ${ac.then}` : String(ac?.raw || "").trim()))
    .filter(Boolean);
  if (fromStructured.length > 0) return fromStructured;
  return String(card?.acceptanceCriteria || "")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

const normalizeVerdicts = (parsed, criteria) => criteria.map((text, i) => {
  const v = Array.isArray(parsed?.criteria) ? parsed.criteria.find((c) => Number(c?.index) === i + 1) : null;
  return {
    index: i + 1,
    text,
    // No entry for a criterion is no evidence for it: not covered, never assumed.
    covered: v ? Boolean(v.covered) : false,
    evidence: typeof v?.evidence === "string" ? v.evidence.trim() : "",
  };
});

export class AcceptanceCoverageRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "acceptance-coverage" });
  }

  // A different AI than the coder: the reviewer's, unless the role has its own.
  resolveProvider() {
    return this.config?.roles?.["acceptance-coverage"]?.provider
      || this.config?.roles?.reviewer?.provider
      || this.config?.reviewer
      || "codex";
  }

  extractInput(input) {
    return { ...super.extractInput(input), criteria: Array.isArray(input?.criteria) ? input.criteria : [], diff: String(input?.diff || "") };
  }

  async buildPrompt({ task, criteria, diff }) {
    this._criteria = criteria;
    return { prompt: buildAcceptanceCoveragePrompt({ criteria, diff, task, instructions: this.instructions }) };
  }

  parseOutput(raw) { return extractFirstJson(raw); }

  // A verdict with no `criteria` array is not a verdict: the reviewer's failure.
  isSuccessful(parsed) { return Array.isArray(parsed?.criteria); }

  buildSuccessResult(parsed, provider) {
    const criteria = normalizeVerdicts(parsed, this._criteria || []);
    const uncovered = criteria.filter((c) => !c.covered);
    return { criteria, uncovered, provider, error: Array.isArray(parsed?.criteria) ? undefined : "no criteria array in the verdict" };
  }

  buildSummary(parsed) {
    if (!Array.isArray(parsed?.criteria)) return "acceptance-coverage: unreadable verdict (no criteria array)";
    const total = (this._criteria || []).length;
    const uncovered = normalizeVerdicts(parsed, this._criteria || []).filter((c) => !c.covered).length;
    return uncovered === 0 ? `acceptance-coverage: ${total}/${total} criteria covered` : `acceptance-coverage: ${uncovered} of ${total} criteria NOT covered`;
  }
}
