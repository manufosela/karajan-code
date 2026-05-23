// Pre-pipeline orchestrator for the spec-reviewer (KJC-PCS-0048 PR 2).
// Called from src/commands/run.js and src/commands/plan/generate.js
// BEFORE the actual pipeline. Decides whether to proceed based on the
// role's findings + the user's answer to the interactive prompt.
// PR 2 only supports [c]ontinue / [x]cancel; refine loop lands in PR 3.

import { SpecReviewerRole } from "../roles/spec-reviewer-role.js";
import { printFindings } from "../utils/display/spec-findings.js";

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
  const res = await role.execute({ spec });

  if (!res.ok) {
    logger?.warn?.(`[spec] reviewer failed: ${res.summary} — continuing without review`);
    return { proceed: true, error: res.result?.error };
  }

  const { severity, findings } = res.result || {};
  if (!findings || findings.length === 0 || severity === "ok") {
    logger?.info?.("✓ spec OK");
    return { proceed: true, severity: "ok", findings: [] };
  }

  printFindings(findings, severity);

  // Non-TTY: cannot prompt; default to "continue" so the pipeline never
  // blocks on a missing TTY. Findings already on stderr.
  if (!askQuestion) return { proceed: true, severity, findings };

  const answer = await askQuestion(
    `Spec review: ${findings.length} finding${findings.length === 1 ? "" : "s"} at severity ${severity}. [c]ontinue / [x]cancel? (default: continue)`,
    { detail: { severity, findingCount: findings.length, categories: [...new Set(findings.map((f) => f.category))] } },
  );

  if (answer === null) return { proceed: false, cancelled: true, severity, findings };
  const n = String(answer).trim().toLowerCase();
  if (n.startsWith("x") || n === "cancel") return { proceed: false, cancelled: true, severity, findings };
  return { proceed: true, severity, findings }; // empty / 'c' / anything else = proceed
}
