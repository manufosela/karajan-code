// Pre-pipeline orchestrator for the spec-reviewer (KJC-PCS-0048 PR 2).
// Called from src/commands/run.js and src/commands/plan/generate.js
// BEFORE the actual pipeline. Decides whether to proceed based on the
// role's findings + the user's answer to the interactive prompt.
// PR 2 only supports [c]ontinue / [x]cancel; refine loop lands in PR 3.

import { SpecReviewerRole } from "../roles/spec-reviewer-role.js";
import { printFindings } from "../utils/display/spec-findings.js";
import { runRefinePass } from "./refine-loop.js";

const MAX_REFINE_ITERATIONS = 5;

export async function runSpecReview({ spec, config, logger, askQuestion, flags = {} }) {
  // VITEST guard — pre-existing test suites (e.g. tests/commands/command-run.test.js)
  // mock `runFlow` + `assertAgentsAvailable` but predate this role and have
  // no need to exercise it. Auto-skip in vitest unless the test passes
  // `flags.forceSpecReview: true` (the spec-review's own tests bypass via
  // their vi.doMock of SpecReviewerRole and never reach this guard).
  if (process.env.VITEST && !flags.forceSpecReview) return { proceed: true, skipped: true };
  if (flags.skipSpecReview || config?.spec_reviewer?.enabled === false) {
    return { proceed: true, skipped: true };
  }
  if (!spec || !String(spec).trim()) return { proceed: true, skipped: true };

  const role = new SpecReviewerRole({ config, logger });
  await role.init({ task: spec });

  // Outer loop: review → prompt → optional refine → re-review (the
  // refine path replaces `currentSpec` and we go around again).
  let currentSpec = spec;
  for (let iter = 0; iter < MAX_REFINE_ITERATIONS; iter += 1) {
    const res = await role.execute({ spec: currentSpec });
    if (!res.ok) {
      logger?.warn?.(`[spec] reviewer failed: ${res.summary} — continuing without review`);
      return { proceed: true, error: res.result?.error, finalSpec: currentSpec };
    }
    const { severity, findings } = res.result || {};
    if (!findings || findings.length === 0 || severity === "ok") {
      logger?.info?.(iter === 0 ? "✓ spec OK" : "✓ refined spec OK");
      return { proceed: true, severity: "ok", findings: [], finalSpec: currentSpec, refined: iter > 0 };
    }
    printFindings(findings, severity);
    if (!askQuestion) return { proceed: true, severity, findings, finalSpec: currentSpec };

    const answer = await askQuestion(
      `Spec review: ${findings.length} finding${findings.length === 1 ? "" : "s"} at severity ${severity}. [c]ontinue / [r]efine / [x]cancel? (default: continue)`,
      { detail: { severity, findingCount: findings.length, categories: [...new Set(findings.map((f) => f.category))], iteration: iter + 1 } },
    );
    if (answer === null) return { proceed: false, cancelled: true, severity, findings };
    const n = String(answer).trim().toLowerCase();
    if (n.startsWith("x") || n === "cancel") return { proceed: false, cancelled: true, severity, findings };
    if (n.startsWith("r") || n === "refine") {
      const refine = await runRefinePass({
        spec: currentSpec, findings, role,
        projectDir: config?.projectDir, taskFile: flags.taskFile, logger,
      });
      if (!refine.ok) {
        logger?.warn?.(`[spec] refine failed: ${refine.error} — proceeding with original spec`);
        return { proceed: true, severity, findings, finalSpec: currentSpec };
      }
      currentSpec = refine.refinedSpec;
      if (refine.hashChanged) continue; // user tweaked v2 → re-review
      logger?.info?.("✓ refined spec accepted by user (no edits)");
      return { proceed: true, severity: "ok", findings: [], finalSpec: currentSpec, refined: true };
    }
    return { proceed: true, severity, findings, finalSpec: currentSpec }; // continue
  }
  logger?.warn?.(`[spec] max refine iterations (${MAX_REFINE_ITERATIONS}) reached — proceeding with last spec`);
  return { proceed: true, finalSpec: currentSpec, refined: true };
}
