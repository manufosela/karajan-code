// KJC-TSK-0987 (issue #1894): the acceptance-coverage stage. With a card whose
// criteria the run was meant to implement, a different AI reads each criterion
// against the diff before the run is approved. No card or no criteria: the
// stage does not run and costs nothing. An unreadable verdict is the judge's
// failure, never an approval.
import { AcceptanceCoverageRole } from "../../roles/acceptance-coverage-role.js";
import { emitProgress, makeEvent } from "../../utils/events.js";

const STAGE = "acceptance-coverage";

/** The feedback the coder gets: the criteria with no evidence in the diff. */
export const uncoveredFeedback = (uncovered) => {
  const lines = uncovered.map((c) => "- [" + c.index + "] " + c.text + (c.evidence ? " (judge: " + c.evidence + ")" : ""));
  return "Acceptance criteria NOT covered by the diff (implement them, with tests that exercise them):\n" + lines.join("\n");
};

/**
 * @returns {Promise<{action: "skip"|"ok"|"retry"|"fail", stageResult?: object, feedback?: string}>}
 */
export async function runAcceptanceCoverageStage({ config, logger, emitter, eventBase, trackBudget, iteration, task, criteria, diff, RoleClass = AcceptanceCoverageRole }) {
  if (!Array.isArray(criteria) || criteria.length === 0) return { action: "skip" };
  logger.setContext?.({ iteration, stage: STAGE });
  emitProgress(emitter, makeEvent(`${STAGE}:start`, { ...eventBase, stage: STAGE }, {
    message: `Acceptance coverage: ${criteria.length} criteria against the diff`,
    detail: { criteria: criteria.length, executorType: "agent" },
  }));
  const role = new RoleClass({ config, logger, emitter });
  await role.init({ task, iteration });
  const started = Date.now();
  const output = await role.run({ task, criteria, diff });
  const provider = output.result?.provider || role.resolveProvider();
  trackBudget?.({ role: STAGE, provider, model: config?.roles?.[STAGE]?.model || null, result: output, duration_ms: Date.now() - started });

  if (!output.ok) {
    const stageResult = { ok: false, summary: output.summary || "acceptance-coverage: the judge gave no verdict", provider, error: output.result?.error || null };
    emitProgress(emitter, makeEvent(`${STAGE}:end`, { ...eventBase, stage: STAGE }, { status: "fail", message: stageResult.summary, detail: stageResult }));
    return { action: "fail", stageResult };
  }
  const { criteria: verdicts, uncovered } = output.result;
  const stageResult = { ok: uncovered.length === 0, summary: output.summary, provider, criteria: verdicts, uncovered };
  emitProgress(emitter, makeEvent(`${STAGE}:end`, { ...eventBase, stage: STAGE }, {
    status: stageResult.ok ? "ok" : "fail", message: output.summary, detail: stageResult,
  }));
  if (stageResult.ok) return { action: "ok", stageResult };
  logger.warn(`${output.summary} — sending them back to the coder`);
  return { action: "retry", stageResult, feedback: uncoveredFeedback(uncovered) };
}
