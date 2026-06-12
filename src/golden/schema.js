/**
 * Golden tasks regression suite — schema (KJC-TSK-0374). Pure data,
 * no I/O. See docs/golden-tasks.md (PR-3) for the full spec.
 */

import * as v from "valibot";

const NonEmptyString = v.pipe(v.string(), v.minLength(1));
const Percent = v.pipe(v.number(), v.minValue(0), v.maxValue(100));

const NonNegInt = v.pipe(v.number(), v.integer(), v.minValue(0));
const LocRangeSchema = v.pipe(v.array(NonNegInt), v.length(2),
  v.check((arr) => arr[0] <= arr[1], "allowed_loc_range: min must be <= max"));

const GoldenTaskSchema = v.looseObject({
  id: v.pipe(NonEmptyString, v.regex(/^[a-z0-9_-]+$/, "id must be lowercase a-z0-9_-")),
  title: NonEmptyString,
  prompt: NonEmptyString,
  description: v.optional(v.string()),
  timeout_minutes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 30),
  expected_commits_min: NonNegInt,
  expected_audit_status: v.picklist(["pass", "warning", "fail"]),
  expected_test_files: v.array(NonEmptyString),
  allowed_loc_range: LocRangeSchema,
  expected_plan_adherence_min: v.optional(Percent),
});

/** @typedef {import("valibot").InferOutput<typeof GoldenTaskSchema>} GoldenTask */

export function parseGoldenTask(raw) {
  return v.parse(GoldenTaskSchema, raw);
}

export function safeParseGoldenTask(raw) {
  const result = v.safeParse(GoldenTaskSchema, raw);
  if (result.success) return { ok: true, task: result.output };
  return { ok: false, issues: result.issues.map((iss) => ({
    path: (iss.path || []).map((p) => p.key).join("."),
    message: iss.message,
  })) };
}
