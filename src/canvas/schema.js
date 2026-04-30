/**
 * REASONS Canvas — Valibot schema for the structured SPEC format.
 *
 * Issue #539. Per Martin Fowler's Structured Prompt-Driven Development
 * (https://martinfowler.com/articles/structured-prompt-driven/), a
 * Canvas captures intent in 7 named sections so the planner doesn't
 * have to improvise. The shape:
 *
 *   Requirements — problem + done-when bullets
 *   Entities     — domain nouns + relationships
 *   Approach     — strategy + trade-offs
 *   Structure    — system fit, dependencies, contracts
 *   Operations   — concrete numbered steps. Each = one HU.
 *   Norms        — task-level engineering standards
 *   Safeguards   — non-negotiables: invariants, perf, security
 *
 * Operations carry their acceptance tests inline so the planner-time
 * validator (validate.js) can check them parse BEFORE any LLM call.
 * That's the bug-class fix this whole feature exists for: the
 * 2026-04-29 incident where the planner emitted a syntactically-broken
 * jq query and the coder iterated 3× against an irreparable test.
 */

import * as v from "valibot";

const NonEmptyString = v.pipe(v.string(), v.minLength(1));

const Entity = v.looseObject({
  name: NonEmptyString,
  fields: v.optional(v.array(v.string())),
  relationships: v.optional(v.array(v.unknown())),
  notes: v.optional(v.string()),
});

const AcceptanceTest = v.looseObject({
  type: v.picklist(["shell", "gherkin"]),
  content: NonEmptyString,
  // optional: file hint for tester translation of gherkin
  file: v.optional(v.string()),
});

const Operation = v.looseObject({
  // Either a free-form title or numbered step text.
  title: NonEmptyString,
  // Optional: the file or module the operation produces / touches.
  file_hint: v.optional(v.string()),
  // Optional: dependencies on other operation titles or HU ids.
  blocked_by: v.optional(v.array(v.string())),
  // Required: at least ONE acceptance test per operation. Empty array
  // is rejected at plan-time so we never ship an HU without a contract.
  acceptance: v.pipe(v.array(AcceptanceTest), v.minLength(1)),
});

export const CanvasSchema = v.looseObject({
  // Title is the project / feature name. The planner uses it as the
  // plan name unless the user overrides on prompt.
  title: NonEmptyString,
  requirements: v.looseObject({
    problem: NonEmptyString,
    // Definition-of-done bullets. Empty array allowed — sometimes the
    // problem statement IS the contract — but a non-empty array
    // discourages woolly specs.
    done: v.optional(v.array(NonEmptyString)),
  }),
  entities: v.optional(v.array(Entity)),
  approach: NonEmptyString,
  structure: v.looseObject({
    touches: v.optional(v.array(v.string())),
    depends_on: v.optional(v.array(v.string())),
    contracts: v.optional(v.array(v.string())),
  }),
  operations: v.pipe(v.array(Operation), v.minLength(1)),
  norms: v.optional(v.array(NonEmptyString)),
  safeguards: v.optional(v.array(NonEmptyString)),
});

/**
 * Validate-only entry point. Throws an Error with the offending path
 * + message when the canvas doesn't match the schema. The validator
 * (validate.js) uses this AND adds parse-checks for acceptance tests.
 *
 * @param {unknown} canvas
 * @returns {import("valibot").InferOutput<typeof CanvasSchema>}
 */
export function parseCanvas(canvas) {
  return v.parse(CanvasSchema, canvas);
}

/**
 * Soft check: returns the validation result without throwing. Useful
 * for surfacing every schema error at once instead of bailing on the
 * first.
 *
 * @param {unknown} canvas
 * @returns {{ success: true, output: object } | { success: false, issues: object[] }}
 */
export function safeParseCanvas(canvas) {
  const r = v.safeParse(CanvasSchema, canvas);
  if (r.success) return { success: true, output: r.output };
  return { success: false, issues: r.issues };
}
