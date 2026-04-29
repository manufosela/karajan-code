/**
 * Repair runner — orchestrates the Repairer role end-to-end.
 *
 * Called from run-hu-batch when an acceptance test failure has been
 * classified as `infeasible` by repair-detector. The runner:
 *   1. Builds the prompt context (failing test, error output, HU
 *      intent, sibling tests).
 *   2. Invokes RepairerRole.
 *   3. If verdict=fixable: patches the plan JSON's acceptance_tests
 *      AND the in-memory batch story so the next coder iteration sees
 *      the corrected test. Saves both. Returns { repaired: true }.
 *   4. If verdict=unfixable: returns { repaired: false, escalate: true,
 *      reason } so the caller can hand off to Solomon / FDE.
 *   5. If RepairerRole itself fails (agent error): returns
 *      { repaired: false, escalate: false, error } so the caller
 *      decides whether to retry coder or escalate.
 */

import { RepairerRole } from "../../roles/repairer-role.js";
import { saveHuBatch } from "../../hu/store.js";
import { emitProgress, makeEvent } from "../../utils/events.js";

/**
 * @param {object} args
 * @param {object} args.story       — the HU story object (in-memory batch slice). MUTATED.
 * @param {number} args.testIndex   — index in story.acceptance_tests of the failing test.
 * @param {string} args.errorOutput — last failing run's stderr+stdout.
 * @param {string} args.batchSessionId
 * @param {object} args.batch       — full batch object. MUTATED (story is a slice).
 * @param {object} args.config
 * @param {object} args.logger
 * @param {object} args.emitter
 * @param {object} args.eventBase
 * @param {string} args.failureKind — repair-detector's `kind` (e.g. "jq-as-binding-misuse").
 * @param {Function} [args.savePlanPatch] — async (huId, fieldPatch) => void; if provided,
 *                                          patches the plan JSON on disk too.
 * @returns {Promise<{repaired: boolean, escalate?: boolean, reason?: string, error?: string}>}
 */
export async function runRepair({
  story, testIndex, errorOutput, batchSessionId, batch,
  config, logger, emitter, eventBase, failureKind, savePlanPatch,
}) {
  if (!story || !Array.isArray(story.acceptance_tests) || !story.acceptance_tests[testIndex]) {
    return { repaired: false, escalate: false, error: "repair-runner: invalid story or testIndex" };
  }

  const failingTest = story.acceptance_tests[testIndex];
  const siblingTests = story.acceptance_tests.filter((_, i) => i !== testIndex);

  emitProgress(emitter, makeEvent("repair:start", { ...eventBase, stage: "repair" }, {
    message: `Repairer invoked for HU ${story.id} test #${testIndex} (kind=${failureKind})`,
    detail: {
      huId: story.id,
      testIndex,
      testContent: typeof failingTest === "object" ? failingTest.content : failingTest,
      kind: failureKind,
    },
  }));

  const repairer = new RepairerRole({ config, logger, emitter });
  await repairer.init({ task: story.scope || story.title || story.id, sessionId: batchSessionId, iteration: 0 });

  let result;
  try {
    result = await repairer.run({
      failingTest,
      errorOutput,
      huTitle: story.title || story.id,
      huScope: story.scope || "",
      siblingTests,
      iteration: 0,
    });
  } catch (err) {
    logger.warn(`Repairer threw: ${err.message}`);
    emitProgress(emitter, makeEvent("repair:end", { ...eventBase, stage: "repair" }, {
      status: "fail",
      message: `Repairer error: ${err.message}`,
      detail: { huId: story.id, testIndex },
    }));
    return { repaired: false, escalate: false, error: err.message };
  }

  if (!result?.ok) {
    logger.warn(`Repairer failed: ${result?.summary || "unknown"}`);
    emitProgress(emitter, makeEvent("repair:end", { ...eventBase, stage: "repair" }, {
      status: "fail",
      message: `Repairer could not produce a verdict: ${result?.summary || "unknown"}`,
      detail: { huId: story.id, testIndex },
    }));
    return { repaired: false, escalate: false, error: result?.summary || "no verdict" };
  }

  const { verdict, fixed_test: fixedTest, reason } = result.result;

  if (verdict === "unfixable") {
    logger.info(`Repairer: HU ${story.id} test #${testIndex} unfixable — ${reason}`);
    emitProgress(emitter, makeEvent("repair:end", { ...eventBase, stage: "repair" }, {
      status: "escalate",
      message: `Repairer: unfixable — ${reason}`,
      detail: { huId: story.id, testIndex, reason },
    }));
    return { repaired: false, escalate: true, reason };
  }

  if (verdict !== "fixable" || !fixedTest) {
    logger.warn(`Repairer returned unexpected verdict: ${verdict}`);
    return { repaired: false, escalate: false, error: `unexpected verdict: ${verdict}` };
  }

  // Apply the fix in-memory and persist when we have the batch handle.
  // Some callers can't pass `batch` from their scope (closure depth);
  // the in-memory mutation of `story.acceptance_tests` is enough for
  // the next iteration of the same HU loop because every acceptance
  // run reads the live story object. Disk persistence is a "next run
  // sees the fix too" optimisation; PR #544's reconcile keeps the
  // plan JSON consistent across runs in either case.
  story.acceptance_tests[testIndex] = fixedTest;
  if (batch && batchSessionId) {
    await saveHuBatch(batchSessionId, batch);
  }

  if (typeof savePlanPatch === "function") {
    try {
      await savePlanPatch(story.id, { acceptance_tests: story.acceptance_tests });
    } catch (err) {
      logger.warn(`Repairer: in-memory + batch fixed but plan-patch failed: ${err.message}`);
    }
  }

  logger.info(`Repairer: HU ${story.id} test #${testIndex} REPAIRED — ${reason}`);
  emitProgress(emitter, makeEvent("repair:end", { ...eventBase, stage: "repair" }, {
    status: "ok",
    message: `Repairer fixed HU ${story.id} test #${testIndex}: ${reason}`,
    detail: {
      huId: story.id,
      testIndex,
      reason,
      fixedContent: typeof fixedTest === "object" ? fixedTest.content : fixedTest,
    },
  }));
  return { repaired: true, reason };
}
