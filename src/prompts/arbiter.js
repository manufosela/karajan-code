/**
 * Arbiter prompt (KJC-TSK-0573, design in docs/specs/autonomous-delivery.md §6).
 *
 * The Arbiter is Karajan's autonomous decision authority: given a conflict, it
 * picks the LEAST-BAD option from a closed set and moves forward — no human.
 */

/** The closed set of conflict-resolution verdicts. BLOCK_AND_CONTINUE is safe. */
export const VERDICTS = Object.freeze([
  "ACCEPT_WITH_DEFECT",
  "RETRY_DIFFERENT_APPROACH",
  "DESCOPE_HU",
  "BLOCK_AND_CONTINUE",
  "PROCEED",
]);

export function buildArbiterPrompt({ question, options = [], context = null } = {}) {
  const allowed = options.length ? options.map((o) => o.value) : VERDICTS;
  return [
    "You are the Arbiter — Karajan's autonomous decision authority. There is no human to ask.",
    "Resolve the conflict below by choosing the LEAST-BAD option and moving forward.",
    "",
    "Ground-truth order (what wins when signals disagree):",
    "  1. Acceptance tests passing — beats any reviewer opinion.",
    "  2. Must-fix issues (security, correctness, data) — beat style.",
    "  3. Nice-to-have (style, optional refactors) — never block; record as a defect if dropped.",
    "Goal: maximize 'the ask is met', minimize irreversible risk. Imperfect-but-delivered beats blocked.",
    "",
    `Conflict: ${question}`,
    context ? `Context: ${JSON.stringify(context)}` : "",
    "",
    `Choose exactly one verdict from: ${allowed.join(", ")}`,
    "Respond with ONLY this JSON (no prose):",
    '{"verdict":"<one of the allowed>","confidence":0.0,"rationale":"why it is the least-bad option","defect":"residual debt if any, else null","directive":"instruction to the coder when RETRY_DIFFERENT_APPROACH, else null"}',
  ]
    .filter(Boolean)
    .join("\n");
}
