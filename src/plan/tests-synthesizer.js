/**
 * Tests-first second pass for `kj plan` (v2.7.5).
 *
 * The first planner call asks for steps + acceptance_tests in one
 * shot. Modern LLMs (Claude, Codex) reliably produce the steps but
 * frequently skip the acceptance_tests sub-instruction when the
 * surrounding spec is dense — a known weakness of long single-shot
 * prompts. Pre-v2.7.5 we papered over this with a generic `npx
 * vitest run` placeholder that wasn't actually a per-HU contract.
 *
 * This module runs a focused SECOND pass that asks the LLM ONLY to
 * fill in tests for the HUs that came back without them. Because the
 * prompt is shorter and has a single deliverable, the hit rate is
 * effectively 100% on the HUs that slipped through the first time.
 *
 * Returns a map `{ huId → acceptance_tests[] }` so the caller can
 * patch the plan in place. The patch always normalises through
 * `plan-schema::normaliseAcceptanceTests`, so any malformed entries
 * the LLM produces are silently dropped (better than corrupting the
 * plan with junk).
 */

import { extractFirstJson } from "../utils/json-extract.js";
import { normaliseAcceptanceTests } from "./plan-schema.js";
import { withBrainRecovery } from "../brain/with-brain-recovery.js";

/**
 * Build the focused-pass prompt asking ONLY for tests for the given
 * HUs. Exported for unit-testing the prompt shape without an LLM.
 *
 * @param {object} args
 * @param {string} args.task
 * @param {Array<{ id: string, title?: string, scope?: string }>} args.husNeedingTests
 * @returns {string}
 */
export function buildSynthesizerPrompt({ task, husNeedingTests, stack = null, testFramework = null }) {
  const lines = [
    "You previously generated an implementation plan for the task below, but some HUs were left without acceptance_tests.",
    "Your ONLY job in this call is to fill that gap.",
    "",
    "Output MUST be a JSON object with this exact shape:",
    "",
    "```json",
    "{",
    '  "tests": {',
    '    "<huId>": [',
    '      { "type": "gherkin", "content": "Given <ctx>\\nWhen <action>\\nThen <outcome>" },',
    '      { "type": "shell", "content": "<bash command that must exit 0>" }',
    "    ]",
    "  }",
    "}",
    "```",
    "",
    "Rules:",
    "- The keys of `tests` are the HU ids EXACTLY as listed below.",
    "- 2-4 tests per HU. At least one happy-path and one edge case.",
    "- gherkin = behaviour spec; shell = concrete bash command exiting 0 on pass.",
    "- Tests must be specific to the HU. Do NOT use generic fallbacks like `npx vitest run`.",
    "- Tests must be writable BEFORE the HU is implemented (they should fail until done).",
    "- Return ONLY the JSON — no prose, no markdown fences around it.",
    "",
  ];
  // Stack-aware hint: tell the LLM what test framework / language to
  // emit shell commands for. Without this it defaulted to vitest /
  // npm even on Python / Go / Rust projects (sesgo-de-stack audit).
  if (stack || testFramework) {
    lines.push("## Project Stack — generate shell tests for THIS stack, not generic JS");
    if (stack?.language) lines.push(`- Language: **${stack.language}**`);
    if (stack?.frameworks?.length) lines.push(`- Frameworks: ${stack.frameworks.join(", ")}`);
    if (testFramework?.hasTests && testFramework?.framework) {
      lines.push(`- Test framework already in use: **${testFramework.framework}** — use it for the shell commands.`);
    } else if (stack?.language && stack.language !== "javascript" && stack.language !== "typescript") {
      lines.push(`- Use the canonical test runner for ${stack.language} (pytest / go test / cargo test / rspec). Do NOT emit vitest, jest, or npm commands.`);
    }
    lines.push("");
  }
  lines.push("## Task", task, "", "## HUs that need acceptance_tests", "");
  for (const hu of husNeedingTests) {
    lines.push(`### ${hu.id}: ${hu.title || ""}`);
    lines.push(hu.scope ? `Scope: ${hu.scope}` : "(no scope)");
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Run the focused second pass. Pass an `agent` with a `runTask`
 * method (Claude / Codex / Gemini wrappers all expose it).
 *
 * @param {object} args
 * @param {object} args.agent
 * @param {string} args.task
 * @param {Array<{ id: string, title?: string, scope?: string }>} args.husNeedingTests
 * @param {Function} [args.onOutput]
 * @param {number} [args.silenceTimeoutMs]
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ ok: boolean, tests?: Record<string, object[]>, error?: string }>}
 */
export async function synthesizeMissingTests({ agent, task, husNeedingTests, onOutput, silenceTimeoutMs, timeoutMs, emitter, eventBase, logger }) {
  if (!Array.isArray(husNeedingTests) || husNeedingTests.length === 0) {
    return { ok: true, tests: {} };
  }
  const prompt = buildSynthesizerPrompt({ task, husNeedingTests });
  const runArgs = { prompt, role: "planner" };
  if (onOutput) runArgs.onOutput = onOutput;
  if (silenceTimeoutMs) runArgs.silenceTimeoutMs = silenceTimeoutMs;
  if (timeoutMs) runArgs.timeoutMs = timeoutMs;

  // KJC-TSK-0413: Brain Recovery wraps el agent call.
  const result = await withBrainRecovery({
    agent, taskArgs: runArgs, role: "tests-synthesizer",
    emitter, eventBase, logger,
  });
  if (!result.ok) {
    return { ok: false, error: result.error || `synthesizer agent failed (${result.recovery?.class || "unknown"})`, recovery: result.recovery, action: result.action };
  }

  const parsed = extractFirstJson(result.output || "");
  const rawTests = parsed?.tests;
  if (!rawTests || typeof rawTests !== "object") {
    return { ok: false, error: "synthesizer returned no `tests` object" };
  }

  // Normalise per HU so junk entries don't slip into the plan.
  const tests = {};
  for (const [huId, list] of Object.entries(rawTests)) {
    const cleaned = normaliseAcceptanceTests(list);
    if (cleaned.length > 0) tests[huId] = cleaned;
  }
  return { ok: true, tests };
}
