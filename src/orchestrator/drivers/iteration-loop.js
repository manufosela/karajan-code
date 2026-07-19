/**
 * Iteration-loop driver — extracted from src/orchestrator/flow-runner.js
 * in TSK-0335 (Oleada 3 of the v2.7.4 audit refactor).
 *
 * Everything inside the coder→reviewer loop:
 *
 *   - runCoderAndRefactorerStages: coder (+ refactorer if enabled), with
 *                                  standby handling per stage.
 *   - runGuardStages:              deterministic output/perf guards on the diff.
 *   - runQualityGateStages:        TDD check, Sonar (local + cloud), Impeccable.
 *   - runReviewerGateStage:        reviewer role, with standby handling.
 *   - handleApprovedReview:        wire post-loop stages + finalize session.
 *   - runSingleIteration:          one coder→reviewer cycle (the iteration body).
 *   - runIterationLoop:            the while loop, checkpoints, budget/time
 *                                  gates, error recovery via Solomon,
 *                                  max-iterations extension path.
 *
 * Extracted verbatim; no behavior change. flow-runner.js now imports these
 * instead of defining them. Part of breaking up the 2254-LOC god-module —
 * see docs/ARCHITECTURE.md and the TSK-0335 acceptance criteria.
 */

import { emitProgress, makeEvent } from "../../utils/events.js";
import { msg, getLang } from "../../utils/messages.js";
import { saveSession, markSessionStatus } from "../../session/store.js";
import {
  setReviewerFeedback, resetRetryCount,
} from "../../session/mutators.js";
import { invokeSolomon } from "../solomon-escalation.js";
import { buildIterationReport, handleIterationGate } from "../iteration-gate.js";
import {
  handleCiEarlyPrOrPush, handleCiReviewDispatch,
} from "../ci-integration.js";
import {
  handleCheckpoint, checkSessionTimeout, checkBudgetExceeded,
  takeCheckpointSnapshot,
} from "../flow-control.js";
import {
  handleSolomonCheck, handleReviewerRetryAndSolomon,
} from "./error-recovery.js";
import { handleMaxIterationsReached } from "./post-loop.js";
import { runCoderAndRefactorerStages } from "./iteration-phases/coder-and-refactorer.js";
import { runGuardStages } from "./iteration-phases/guards.js";
import { runQualityGateStages } from "./iteration-phases/quality-gates.js";
import { runReviewerGateStage } from "./iteration-phases/reviewer-gate.js";
import { handleApprovedReview } from "./iteration-phases/handle-approved.js";

// `runCoderAndRefactorerStages`, `runGuardStages`, `runQualityGateStages`,
// `runReviewerGateStage` and `handleApprovedReview` were extracted to
// ./iteration-phases/ in the v2.7.x audit follow-up (same pattern as
// pre-loop-phases/). The back-compat re-exports were removed in
// KJC-TSK-0354 PR-D — no caller imported them via this module.

async function runSingleIteration(ctx) {
  // Use plannedTask (HU-scoped or planner-enriched) over the raw original task.
  // When running per-HU sub-pipelines, plannedTask is the HU's text, not the full spec.
  const { config, logger, emitter, eventBase, session, iteration: i } = ctx;
  const task = ctx.plannedTask || ctx.task;

  const iterStart = Date.now();
  const ciEnabled = Boolean(config.ci?.enabled) && ctx.gitCtx?.enabled;
  logger.setContext({ iteration: i, stage: "iteration" });

  const reviewerRetryCount = session.reviewer_retry_count || 0;
  const maxReviewerRetries = config.session.max_reviewer_retries ?? config.session.fail_fast_repeats;
  const iterLang = getLang(config);
  const iterMsg = msg("pipeline_iteration", iterLang, { current: i, max: config.max_iterations });
  emitProgress(emitter, makeEvent("iteration:start", { ...eventBase, stage: "iteration" }, {
    message: iterMsg,
    detail: { iteration: i, maxIterations: config.max_iterations, reviewerRetryCount, maxReviewerRetries }
  }));
  logger.info(iterMsg);

  const crResult = await runCoderAndRefactorerStages({
    coderRoleInstance: ctx.coderRoleInstance, coderRole: ctx.coderRole, refactorerRole: ctx.refactorerRole,
    pipelineFlags: ctx.pipelineFlags, config, logger, emitter, eventBase, session,
    plannedTask: ctx.plannedTask, trackBudget: ctx.trackBudget, i, brainCtx: ctx.brainCtx
  });
  if (crResult.action === "return" || crResult.action === "retry") return crResult;

  const guardResult = await runGuardStages({ config, logger, emitter, eventBase, session, iteration: i });
  if (guardResult.action === "return") return guardResult;

  const qgResult = await runQualityGateStages({
    config, logger, emitter, eventBase, session, trackBudget: ctx.trackBudget, i,
    askQuestion: ctx.askQuestion, repeatDetector: ctx.repeatDetector, budgetSummary: ctx.budgetSummary,
    sonarState: ctx.sonarState, task, stageResults: ctx.stageResults, coderRole: ctx.coderRole,
    pipelineFlags: ctx.pipelineFlags, brainCtx: ctx.brainCtx
  });
  if (qgResult.action === "return" || qgResult.action === "continue") return qgResult;

  await handleCiEarlyPrOrPush({
    ciEnabled, config, session, emitter, eventBase, gitCtx: ctx.gitCtx, task, logger,
    stageResults: ctx.stageResults, i
  });

  const revResult = await runReviewerGateStage({
    pipelineFlags: ctx.pipelineFlags, reviewerRole: ctx.reviewerRole, config, logger, emitter, eventBase,
    session, trackBudget: ctx.trackBudget, i, reviewRules: ctx.reviewRules, task,
    repeatDetector: ctx.repeatDetector, budgetSummary: ctx.budgetSummary, askQuestion: ctx.askQuestion,
    brainCtx: ctx.brainCtx
  });
  if (revResult.action === "return" || revResult.action === "retry") return revResult;
  const review = revResult.review;

  const iterDuration = Date.now() - iterStart;
  emitProgress(emitter, makeEvent("iteration:end", { ...eventBase, stage: "iteration" }, {
    message: `Iteration ${i} completed`, detail: { duration: iterDuration }
  }));
  resetRetryCount(session, "standby");

  // --- Journal: record iteration ---
  // Uses the richer iteration-logger from TSK-0286: captures blocking-issue
  // details, sonar counts and Solomon rulings in addition to summaries.
  if (ctx.journalIterations) {
    try {
      const { recordIteration, extractIterationData } = await import("../../session/journal/iteration-logger.js");
      const iterationData = extractIterationData({
        iteration: i,
        durationMs: iterDuration,
        stageResults: ctx.stageResults,
        session: ctx.session,
      });
      // Derive a richer reviewer summary if none was produced.
      if (!iterationData.reviewerSummary && review) {
        iterationData.reviewerSummary = review.approved
          ? `Approved: ${review.raw_summary || ""}`
          : `Rejected: ${(review?.blocking_issues || []).length} blocking issue(s)`;
      }
      if (!iterationData.blockingIssues || iterationData.blockingIssues.length === 0) {
        iterationData.blockingIssues = review?.blocking_issues || [];
      }
      recordIteration(ctx.session, iterationData);
    } catch (err) {
      logger.warn(`Iteration journal record failed (non-blocking): ${err.message}`);
    }
  }

  const solomonResult = await handleSolomonCheck({
    config, session, emitter, eventBase, logger, task, i, askQuestion: ctx.askQuestion,
    ciEnabled, blockingIssues: review?.blocking_issues, brainCtx: ctx.brainCtx
  });
  if (solomonResult.action === "pause") return { action: "return", result: solomonResult.result };

  await handleCiReviewDispatch({ ciEnabled, config, session, review, i, logger });

  if (review.approved) {
    const approvedResult = await handleApprovedReview({
      config, session, emitter, eventBase, coderRole: ctx.coderRole, trackBudget: ctx.trackBudget, i, task,
      stageResults: ctx.stageResults, pipelineFlags: ctx.pipelineFlags, askQuestion: ctx.askQuestion, logger,
      gitCtx: ctx.gitCtx, budgetSummary: ctx.budgetSummary, pgCard: ctx.pgCard, pgProject: ctx.pgProject, review,
      rtkTracker: ctx.rtkTracker, brainCtx: ctx.brainCtx
    });
    if (approvedResult.action === "return" || approvedResult.action === "continue") return approvedResult;
  }

  // Solomon already evaluated the rejection in runReviewerStage -> handleReviewerRejection
  // Only use retry counter as fallback if Solomon is disabled
  if (!config.pipeline?.solomon?.enabled) {
    const retryResult = await handleReviewerRetryAndSolomon({ config, session, emitter, eventBase, logger, review, task, i, askQuestion: ctx.askQuestion });
    if (retryResult.action === "return") return retryResult;
  } else {
    // Solomon is enabled — feed back the blocking issues for the next coder iteration
    setReviewerFeedback(session, review.blocking_issues
      .map((x) => {
        const parts = [`[${x.severity || "high"}] ${x.id || "ISSUE"}: ${x.description || "Missing description"}`];
        if (x.file) parts.push(`  File: ${x.file}${x.line ? `:${x.line}` : ""}`);
        if (x.suggested_fix) parts.push(`  Fix: ${x.suggested_fix}`);
        return parts.join("\n");
      })
      .join("\n\n"));
    await saveSession(session);
  }

  return { action: "next" };
}


/**
 * Run the standard iteration loop for a given task using the pipeline context.
 * Returns a result object with at least { approved: boolean }.
 * Used both as the main loop and as the per-HU callback in sub-pipeline mode.
 */
export async function runIterationLoop(ctx, { task: loopTask, askQuestion, emitter, logger }) {
  ctx.plannedTask = loopTask;

  const checkpointIntervalMs = (ctx.config.session.checkpoint_interval_minutes ?? 5) * 60 * 1000;
  let lastCheckpointAt = Date.now();
  let checkpointDisabled = false;
  let lastCheckpointSnapshot = takeCheckpointSnapshot(ctx.session);

  let i = 0;
  while (i < ctx.config.max_iterations) {
    i += 1;
    const elapsedMinutes = (Date.now() - ctx.startedAt) / 60000;

    const cpResult = await handleCheckpoint({
      checkpointDisabled, askQuestion, lastCheckpointAt, checkpointIntervalMs, elapsedMinutes,
      i, config: ctx.config, budgetTracker: ctx.budgetTracker, stageResults: ctx.stageResults, emitter, eventBase: ctx.eventBase, session: ctx.session, budgetSummary: ctx.budgetSummary, lastCheckpointSnapshot
    });
    if (cpResult.action === "stop") {
      return cpResult.result;
    }
    checkpointDisabled = cpResult.checkpointDisabled;
    lastCheckpointAt = cpResult.lastCheckpointAt;
    if (cpResult.lastCheckpointSnapshot !== undefined) lastCheckpointSnapshot = cpResult.lastCheckpointSnapshot;

    await checkSessionTimeout({ askQuestion, elapsedMinutes, config: ctx.config, session: ctx.session, emitter, eventBase: ctx.eventBase, i, budgetSummary: ctx.budgetSummary });
    await checkBudgetExceeded({ budgetTracker: ctx.budgetTracker, config: ctx.config, session: ctx.session, emitter, eventBase: ctx.eventBase, i, budgetLimit: ctx.budgetLimit, budgetSummary: ctx.budgetSummary });

    ctx.eventBase.iteration = i;
    ctx.iteration = i;

    let iterResult;
    try {
      iterResult = await runSingleIteration(ctx);
    } catch (stageError) {
      // ANY unhandled error in a stage = out of normal flow → Solomon decides
      logger.warn(`Stage error caught — escalating to Solomon: ${stageError.message}`);
      const solomonResult = await invokeSolomon({
        config: ctx.config, logger, emitter, eventBase: ctx.eventBase,
        stage: "stage_error", askQuestion, session: ctx.session, iteration: i,
        conflict: {
          stage: "stage_error",
          task: loopTask,
          iterationCount: i,
          maxIterations: ctx.config.max_iterations,
          budget_usd: ctx.budgetSummary()?.total_cost_usd || 0,
          history: [{ agent: "pipeline", feedback: `Stage threw: ${stageError.message}` }]
        }
      });

      if (solomonResult.action === "approve") {
        logger.info("Solomon approved despite stage error");
        return { approved: true, sessionId: ctx.session.id, reason: "solomon_approved_after_error" };
      }
      if (solomonResult.action === "continue") {
        if (solomonResult.humanGuidance) {
          setReviewerFeedback(ctx.session, `Solomon guidance: ${solomonResult.humanGuidance}`);
        }
        continue; // next iteration
      }
      if (solomonResult.action === "pause") {
        return { paused: true, sessionId: ctx.session.id, question: solomonResult.question, context: "stage_error" };
      }
      // Solomon couldn't resolve — fail
      await markSessionStatus(ctx.session, "failed");
      return { approved: false, sessionId: ctx.session.id, reason: "stage_error", error: stageError.message };
    }

    if (iterResult.action === "return") {
      return iterResult.result;
    }
    if (iterResult.action === "retry") { i -= 1; }
    else {
      await ensureIterationRecorded(ctx, i, logger);
      // Iteration gate (KJC-TSK-0628): opt-in pause with a report before the
      // next iteration; free-text answers become directives for the coder.
      const gate = await handleIterationGate({
        enabled: ctx.config.session?.iteration_gate === true,
        askQuestion, session: ctx.session, logger,
        report: buildIterationReport({
          i, maxIterations: ctx.config.max_iterations, stageResults: ctx.stageResults,
          budgetTracker: ctx.budgetTracker, maxBudgetUsd: ctx.config.max_budget_usd,
        }),
      });
      if (gate.action === "stop") {
        return { approved: false, sessionId: ctx.session.id, reason: "user_stopped_at_gate", iteration: i };
      }
    }
  }

  // Solomon decides whether to extend iterations or stop
  const maxIterResult = await handleMaxIterationsReached({ session: ctx.session, budgetSummary: ctx.budgetSummary, emitter, eventBase: ctx.eventBase, config: ctx.config, stageResults: ctx.stageResults, logger, askQuestion, task: loopTask, rtkTracker: ctx.rtkTracker, brainCtx: ctx.brainCtx });

  // Solomon said "continue" — extend iterations and keep going
  if (maxIterResult.reason === "max_iterations_extended") {
    const extra = maxIterResult.extraIterations || ctx.config.max_iterations;
    ctx.config.max_iterations += extra;
    logger.info(`Solomon extended pipeline by ${extra} iterations (new max: ${ctx.config.max_iterations})`);

    if (maxIterResult.humanGuidance) {
      setReviewerFeedback(ctx.session, `Solomon guidance: ${maxIterResult.humanGuidance}`);
    }

    // Continue the loop
    while (i < ctx.config.max_iterations) {
      i += 1;
      const elapsedMinutes = (Date.now() - ctx.startedAt) / 60000;

      const cpResult = await handleCheckpoint({
        checkpointDisabled, askQuestion, lastCheckpointAt, checkpointIntervalMs, elapsedMinutes,
        i, config: ctx.config, budgetTracker: ctx.budgetTracker, stageResults: ctx.stageResults, emitter, eventBase: ctx.eventBase, session: ctx.session, budgetSummary: ctx.budgetSummary, lastCheckpointSnapshot
      });
      if (cpResult.action === "stop") return cpResult.result;
      checkpointDisabled = cpResult.checkpointDisabled;
      lastCheckpointAt = cpResult.lastCheckpointAt;
      if (cpResult.lastCheckpointSnapshot !== undefined) lastCheckpointSnapshot = cpResult.lastCheckpointSnapshot;

      await checkSessionTimeout({ askQuestion, elapsedMinutes, config: ctx.config, session: ctx.session, emitter, eventBase: ctx.eventBase, i, budgetSummary: ctx.budgetSummary });
      await checkBudgetExceeded({ budgetTracker: ctx.budgetTracker, config: ctx.config, session: ctx.session, emitter, eventBase: ctx.eventBase, i, budgetLimit: ctx.budgetLimit, budgetSummary: ctx.budgetSummary });

      ctx.eventBase.iteration = i;
      ctx.iteration = i;

      const iterResult = await runSingleIteration(ctx);
      if (iterResult.action === "return") return iterResult.result;
      if (iterResult.action === "retry") { i -= 1; }
      else {
        await ensureIterationRecorded(ctx, i, logger);
        // Same iteration gate on Solomon-extended iterations (KJC-TSK-0628).
        const gate = await handleIterationGate({
          enabled: ctx.config.session?.iteration_gate === true,
          askQuestion, session: ctx.session, logger,
          report: buildIterationReport({
            i, maxIterations: ctx.config.max_iterations, stageResults: ctx.stageResults,
            budgetTracker: ctx.budgetTracker, maxBudgetUsd: ctx.config.max_budget_usd,
          }),
        });
        if (gate.action === "stop") {
          return { approved: false, sessionId: ctx.session.id, reason: "user_stopped_at_gate", iteration: i };
        }
      }
    }

    // Extended iterations also exhausted — final Solomon call
    const finalResult = await handleMaxIterationsReached({ session: ctx.session, budgetSummary: ctx.budgetSummary, emitter, eventBase: ctx.eventBase, config: ctx.config, stageResults: ctx.stageResults, logger, askQuestion, task: loopTask, rtkTracker: ctx.rtkTracker, brainCtx: ctx.brainCtx });
    return finalizeMaxIterationsApproval(ctx, finalResult, { task: loopTask, askQuestion, emitter, logger, i });
  }

  return finalizeMaxIterationsApproval(ctx, maxIterResult, { task: loopTask, askQuestion, emitter, logger, i });
}

// KJC-BUG-0117: iterations that end before the reviewer (TDD/sonar
// "continue", guard retries) never reached the recordIteration call at
// the end of runSingleIteration, so session._journalIterations stayed
// empty and the journal read "Iterations: 0" after a 5-iteration run.
export async function ensureIterationRecorded(ctx, i, logger) {
  if (!ctx.journalIterations) return;
  if ((ctx.session._journalIterations?.length || 0) >= i) return;
  try {
    const { recordIteration, extractIterationData } = await import("../../session/journal/iteration-logger.js");
    recordIteration(ctx.session, extractIterationData({
      iteration: i, durationMs: 0, stageResults: ctx.stageResults, session: ctx.session,
    }));
  } catch (err) {
    logger.warn(`Iteration journal record failed (non-blocking): ${err.message}`);
  }
}

// KJC-BUG-0116: an "approved" verdict at max_iterations (brain_approved,
// brain_solomon_approved, solomon_approved) used to be returned as-is,
// skipping the entire post-loop (tester/security/audit) AND git
// automation (push/PR) that every reviewer-approved session gets — the
// session read "approved" with zero verification and zero push. Route it
// through the same handleApprovedReview path instead.
export async function finalizeMaxIterationsApproval(ctx, maxIterResult, { task, askQuestion, emitter, logger, i }) {
  if (maxIterResult?.approved !== true) return maxIterResult;

  const review = {
    approved: true,
    raw_summary: `Finalized at max_iterations (${maxIterResult.reason || "approved"})`,
    blocking_issues: []
  };
  const fin = await handleApprovedReview({
    config: ctx.config, session: ctx.session, emitter, eventBase: ctx.eventBase,
    coderRole: ctx.coderRole, trackBudget: ctx.trackBudget, i, task,
    stageResults: ctx.stageResults, pipelineFlags: ctx.pipelineFlags, askQuestion, logger,
    gitCtx: ctx.gitCtx, budgetSummary: ctx.budgetSummary, pgCard: ctx.pgCard, pgProject: ctx.pgProject,
    review, rtkTracker: ctx.rtkTracker, brainCtx: ctx.brainCtx
  });
  if (fin.action === "return") return fin.result;

  // Post-loop demanded another coder pass but iterations are exhausted —
  // report honestly instead of a false green.
  logger.warn("Post-loop stages rejected the work at max_iterations — session NOT approved");
  await markSessionStatus(ctx.session, "failed");
  return { approved: false, sessionId: ctx.session.id, reason: "post_loop_rejected_at_max_iterations" };
}

