/**
 * REASONS Canvas validator.
 *
 * Schema validation + planner-time sanity checks for acceptance tests.
 * The schema is enforced via Valibot in canvas/schema.js. This module
 * adds the bug-class fix: parse-check every shell acceptance test
 * BEFORE it gets persisted into a plan and BEFORE any LLM is called.
 *
 * Catches the 2026-04-29 incident class:
 *   `length as $n | .filesOver300LOC == $n` → exits non-zero with a
 *   descriptive error pointing at the offending operation + test
 *   index, BEFORE the user has paid for any agent run.
 */

import { spawnSync } from "node:child_process";
import { safeParseCanvas } from "./schema.js";

/**
 * Run a single shell acceptance test through `bash -n` (parse-only,
 * doesn't execute) to catch shell-level syntax errors. Then, if the
 * test invokes `jq`, also probe the jq query through `jq -n <query>`
 * with empty input — jq errors there iff the query has bad syntax.
 *
 * Trade-off accepted: bash -n won't catch every command-substitution
 * pitfall (it parses but doesn't expand), and jq -n with empty input
 * may pass queries that fail at runtime against real input. The point
 * is to catch the OBVIOUS bugs cheaply, not to be airtight.
 *
 * @param {string} cmd
 * @returns {{ ok: true } | { ok: false, kind: string, error: string }}
 */
export function validateShellTest(cmd) {
  if (typeof cmd !== "string" || cmd.trim().length === 0) {
    return { ok: false, kind: "empty", error: "shell test is empty" };
  }

  // Layer 1: bash -n parse-check on the whole command.
  const bash = spawnSync("bash", ["-n", "-c", cmd], { encoding: "utf8", timeout: 5000 });
  if (bash.status !== 0) {
    const err = (bash.stderr || "").trim() || "bash -n rejected the command";
    return { ok: false, kind: "shell-syntax", error: err };
  }

  // Layer 2: every `jq '...'` invocation gets its query parse-checked.
  // Permissive regex: catches `jq -e 'X'`, `jq "X"`, `| jq 'X'`. False
  // negatives are fine — better to skip a real jq than misinterpret a
  // shell-quoting edge case.
  //
  // We distinguish COMPILE errors (the bug we want to catch — invalid
  // syntax, e.g. `length as $n | .field` over an array) from RUNTIME
  // errors (the query is well-formed but fails on null input from
  // `-n`, like `.foo[]` on null). Only compile errors fail validation;
  // runtime errors against synthetic input are expected because real
  // input isn't available at plan-time.
  const jqRe = /\bjq\b\s+(?:-[a-zA-Z]+\s+)*(?:'([^']+)'|"([^"]+)")/g;
  for (const m of cmd.matchAll(jqRe)) {
    const query = m[1] || m[2];
    if (!query) continue;

    // Static pattern detector for the 2026-04-29 as-binding misuse:
    // `[expr] | length as $X | .field` and similar. The `as $X`
    // binds the value to a name but does NOT change the value
    // flowing through the pipe. The next `.field` is therefore
    // applied to the array tail (or whatever the previous stage
    // returned), not to the original root. Always wrong.
    //
    // Detection: a pipeline whose tail is `length as $X | .X` (or
    // any `<terminal-operator> as $X | .field`) is the smell.
    const asBindingMisuse = /\b(?:length|keys|values|min|max|add|first|last)\s+as\s+\$[A-Za-z_][\w]*\s*\|\s*\.[A-Za-z_]/;
    if (asBindingMisuse.test(query)) {
      return {
        ok: false,
        kind: "jq-syntax",
        error: "Likely as-binding misuse: `length as $n | .field` does not change the value flowing through; `.field` is applied to the previous stage's output, not the root. Use `. as $r | <transform> | $r.field` instead.",
      };
    }

    const jq = spawnSync("jq", ["-n", query], { encoding: "utf8", timeout: 5000 });
    if (jq.status !== 0) {
      const err = (jq.stderr || "").trim() || "jq rejected the query";
      // jq distinguishes compile errors with these tokens. Anything
      // else (e.g. "Cannot index null with string") is a runtime error
      // against the empty input, NOT a syntax bug.
      const isCompileError = /\b(compile error|syntax error|unexpected|jq: error \(at <stdin>:\d+\): ?$)/i.test(err);
      if (isCompileError) {
        return { ok: false, kind: "jq-syntax", error: err };
      }
      // Special case: `length as $n | .field` returns "Cannot index
      // array/number/string with string" on -n input because the as-
      // binding misuse means `.field` is applied to the wrong thing.
      // This is exactly the 2026-04-29 bug class. Treat it as syntax-
      // adjacent: the query is "compilable" but semantically broken
      // by misuse of as-binding.
      if (/Cannot index (array|number|string) with string/i.test(err)) {
        return { ok: false, kind: "jq-syntax", error: err };
      }
      // Otherwise let it pass — runtime error against synthetic input
      // is fine. jq parsed the query successfully.
    }
  }

  return { ok: true };
}

/**
 * Validate every operation's acceptance tests in a parsed Canvas.
 * Returns an array of issues; empty array means everything passed.
 *
 * @param {object} canvas
 * @returns {Array<{ operationIndex: number, operationTitle: string, testIndex: number, type: string, content: string, kind: string, error: string }>}
 */
export function validateAcceptanceTests(canvas) {
  const issues = [];
  if (!canvas || !Array.isArray(canvas.operations)) return issues;
  canvas.operations.forEach((op, opIdx) => {
    (op.acceptance || []).forEach((t, tIdx) => {
      if (t.type === "shell") {
        const r = validateShellTest(t.content);
        if (!r.ok) {
          issues.push({
            operationIndex: opIdx,
            operationTitle: op.title,
            testIndex: tIdx,
            type: t.type,
            content: t.content,
            kind: r.kind,
            error: r.error,
          });
        }
      } else if (t.type === "gherkin") {
        // Minimal gherkin sanity: must contain at least one Given AND
        // one Then. When/And/But are optional. This catches "blank
        // gherkin" without trying to parse the language.
        if (!/\bGiven\b/i.test(t.content) || !/\bThen\b/i.test(t.content)) {
          issues.push({
            operationIndex: opIdx,
            operationTitle: op.title,
            testIndex: tIdx,
            type: t.type,
            content: t.content,
            kind: "gherkin-incomplete",
            error: "Gherkin scenario must contain at least one Given and one Then.",
          });
        }
      }
    });
  });
  return issues;
}

/**
 * Top-level validator. Runs schema + acceptance-test parse-checks.
 *
 * @param {unknown} canvas
 * @returns {{ valid: true, canvas: object } | { valid: false, schemaIssues?: object[], testIssues?: object[] }}
 */
export function validateCanvas(canvas) {
  const schema = safeParseCanvas(canvas);
  if (!schema.success) return { valid: false, schemaIssues: schema.issues };
  const testIssues = validateAcceptanceTests(schema.output);
  if (testIssues.length > 0) return { valid: false, testIssues };
  return { valid: true, canvas: schema.output };
}
