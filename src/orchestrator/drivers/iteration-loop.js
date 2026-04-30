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
import { markSessionStatus, addCheckpoint, saveSession } from "../../session/store.js";
import {
  setReviewerFeedback, resetRetryCount,
} from "../../session/mutators.js";
import { generateDiff, computeBaseRef } from "../../review/diff-generator.js";
import { scanDiff } from "../../guards/output-guard.js";
import { scanPerfDiff } from "../../guards/perf-guard.js";
import { invokeSolomon } from "../solomon-escalation.js";
import {
  runRefactorerStage, runTddCheckStage,
  runSonarStage, runSonarCloudStage,
} from "../iteration-stages.js";
// TSK-0336: coder and reviewer go through the StageRegistry contract. The
// registered classes (CoderStage / ReviewerStage) delegate execute() to
// runCoderStage / runReviewerStage, so behavior is unchanged — the
// difference is that canRun now gates execution declaratively instead of
// requiring the callsite to guard the call itself.
import { stageRegistry } from "../stages/stage-classes.js";
import { runStage } from "../stages/stage-executor.js";
import { runImpeccableStage } from "../post-loop-stages.js";
import {
  handleCiEarlyPrOrPush, handleCiReviewDispatch, tryCiComment,
} from "../ci-integration.js";
import {
  handleCheckpoint, checkSessionTimeout, checkBudgetExceeded,
  takeCheckpointSnapshot,
} from "../flow-control.js";
import {
  handleStandbyResult, handleSolomonCheck, handleReviewerRetryAndSolomon,
} from "./error-recovery.js";
import {
  handlePostLoopStages, finalizeApprovedSession, handleMaxIterationsReached,
} from "./post-loop.js";

export async function runCoderAndRefactorerStages({ coderRoleInstance, coderRole, refactorerRole, pipelineFlags, config, logger, emitter, eventBase, session, plannedTask, trackBudget, i, brainCtx }) {
  // Coder via StageRegistry (TSK-0336). canRun = coderRequired !== false; in
  // analysis-only task types coderRequired is set to false by policy, so the
  // stage is never even entered — matches the previous guard at the top of
  // runFlow.
  const coderCtx = { coderRoleInstance, coderRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration: i, brainCtx, pipelineFlags };
  const coderResult = await runStage(stageRegistry.get("coder"), coderCtx);
  if (coderResult?.action === "pause") return { action: "return", result: coderResult.result };
  const coderStandby = await handleStandbyResult({ stageResult: coderResult, session, emitter, eventBase, i, stage: "coder", logger, config });
  if (coderStandby.handled) {
    return coderStandby.action === "return"
      ? { action: "return", result: coderStandby.result }
      : { action: "retry" };
  }

  if (pipelineFlags.refactorerEnabled) {
    const refResult = await runRefactorerStage({ refactorerRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration: i });
    if (refResult?.action === "pause") return { action: "return", result: refResult.result };
    const refStandby = await handleStandbyResult({ stageResult: refResult, session, emitter, eventBase, i, stage: "refactorer", logger, config });
    if (refStandby.handled) {
      return refStandby.action === "return"
        ? { action: "return", result: refStandby.result }
        : { action: "retry" };
    }
  }

  return { action: "ok" };
}

export async function runGuardStages({ config, logger, emitter, eventBase, session, iteration }) {
  const outputEnabled = config.guards?.output?.enabled !== false;
  const perfEnabled = config.guards?.perf?.enabled !== false;

  if (!outputEnabled && !perfEnabled) return { action: "ok" };

  const baseBranch = config.base_branch || "main";
  let diff;
  try {
    const baseRef = await computeBaseRef({ baseBranch });
    diff = await generateDiff({ baseRef });
  } catch {
    logger.warn("Guards: could not generate diff, skipping");
    return { action: "ok" };
  }

  if (!diff) return { action: "ok" };

  if (outputEnabled) {
    const outputResult = scanDiff(diff, config);
    if (outputResult.violations.length > 0) {
      const critical = outputResult.violations.filter(v => v.severity === "critical");
      const warnings = outputResult.violations.filter(v => v.severity === "warning");
      emitProgress(emitter, makeEvent("guard:output", { ...eventBase, stage: "guard" }, {
        message: `Output guard: ${critical.length} critical, ${warnings.length} warnings`,
        detail: { violations: outputResult.violations, executorType: "local" }
      }));
      logger.info(`Output guard: ${outputResult.violations.length} violation(s) found`);
      for (const v of outputResult.violations) {
        logger.info(`  [${v.severity}] ${v.file}:${v.line} — ${v.message}`);
      }
      await addCheckpoint(session, { stage: "guard-output", iteration, pass: outputResult.pass, violations: outputResult.violations.length });

      if (!outputResult.pass && config.guards.output.on_violation === "block") {
        await markSessionStatus(session, "failed");
        emitProgress(emitter, makeEvent("guard:blocked", { ...eventBase, stage: "guard" }, {
          message: "Output guard blocked: critical violations detected",
          detail: { violations: critical }
        }));
        return {
          action: "return",
          result: { approved: false, sessionId: session.id, reason: "guard_blocked", violations: critical }
        };
      }
    }
  }

  if (perfEnabled) {
    const perfResult = scanPerfDiff(diff, config);
    if (!perfResult.skipped && perfResult.violations.length > 0) {
      emitProgress(emitter, makeEvent("guard:perf", { ...eventBase, stage: "guard" }, {
        message: `Perf guard: ${perfResult.violations.length} issue(s)`,
        detail: { violations: perfResult.violations, executorType: "local" }
      }));
      logger.info(`Perf guard: ${perfResult.violations.length} issue(s) found`);
      for (const v of perfResult.violations) {
        logger.info(`  [${v.severity}] ${v.file}:${v.line} — ${v.message}`);
      }
      await addCheckpoint(session, { stage: "guard-perf", iteration, pass: perfResult.pass, violations: perfResult.violations.length });
    }
  }

  return { action: "ok" };
}

export async function runQualityGateStages({ config, logger, emitter, eventBase, session, trackBudget, i, askQuestion, repeatDetector, budgetSummary, sonarState, task, stageResults, coderRole, pipelineFlags, brainCtx }) {
  const tddResult = await runTddCheckStage({ config, logger, emitter, eventBase, session, trackBudget, iteration: i, askQuestion, task, brainCtx });
  if (tddResult.action === "pause") return { action: "return", result: tddResult.result };
  if (tddResult.action === "continue") return { action: "continue" };

  // Sonar runs for code tasks per policy. Since v2.7.4 it is NOT
  // toggleable via config — that's intrinsic to Karajan. The taskType
  // policy (resolved_policies.sonar) is the single source of truth.
  // Solomon may skip a single iteration via rule alerts; that's a
  // runtime decision, not a config option.
  //
  // Test-harness escape hatch via config.testHarness.disableSonarStage
  // — production code reads `config?.testHarness?.disableSonarStage`,
  // never `globalThis.*`. The legacy override surface is documented
  // (and exclusively read) in src/config/test-harness.js. ESLint rule
  // (#557) blocks any re-introduction of `globalThis.__KJ_*` outside
  // that one file.
  const sonarStageDisabledForTest = config?.testHarness?.disableSonarStage === true;
  if (!sonarStageDisabledForTest && session.resolved_policies?.sonar !== false) {
    const sonarResult = await runSonarStage({
      config, logger, emitter, eventBase, session, trackBudget, iteration: i,
      repeatDetector, budgetSummary, sonarState, askQuestion, task, brainCtx
    });
    if (sonarResult.action === "stalled" || sonarResult.action === "pause") return { action: "return", result: sonarResult.result };
    if (sonarResult.action === "continue") return { action: "continue" };
    if (sonarResult.stageResult) {
      stageResults.sonar = sonarResult.stageResult;
      await tryCiComment({ config, session, logger, agent: "Sonar", body: `SonarQube scan: ${sonarResult.stageResult.summary || "completed"}` });
    }
  }

  if (config.sonarcloud?.enabled) {
    const cloudResult = await runSonarCloudStage({
      config, logger, emitter, eventBase, session, trackBudget, iteration: i
    });
    if (cloudResult.stageResult) {
      stageResults.sonarcloud = cloudResult.stageResult;
    }
  }

  if (pipelineFlags?.impeccableEnabled) {
    const diff = await generateDiff({ baseRef: session.session_start_sha });
    const impeccableMode = pipelineFlags?.impeccableMode || "audit";
    const impeccableResult = await runImpeccableStage({
      config, logger, emitter, eventBase, session, coderRole, trackBudget,
      iteration: i, task, diff, mode: impeccableMode
    });
    if (impeccableResult.stageResult) {
      stageResults.impeccable = impeccableResult.stageResult;
    }
  }

  return { action: "ok" };
}

export async function runReviewerGateStage({ pipelineFlags, reviewerRole, config, logger, emitter, eventBase, session, trackBudget, i, reviewRules, task, repeatDetector, budgetSummary, askQuestion, brainCtx }) {
  // Reviewer via StageRegistry (TSK-0336). ReviewerStage.canRun returns
  // `reviewerEnabled !== false`; when false, runStage returns null and we
  // synthesize the "disabled-by-pipeline" stub (same shape as the previous
  // early-return). Otherwise execute() runs runReviewerStage.
  const reviewerCtx = {
    reviewerRole, config, logger, emitter, eventBase, session, trackBudget,
    iteration: i, reviewRules, task, repeatDetector, budgetSummary, askQuestion,
    brainCtx, pipelineFlags,
  };
  const reviewerResult = await runStage(stageRegistry.get("reviewer"), reviewerCtx);
  if (reviewerResult === null) {
    return {
      action: "ok",
      review: { approved: true, blocking_issues: [], non_blocking_suggestions: [], summary: "Reviewer disabled by pipeline", confidence: 1 }
    };
  }
  if (reviewerResult.action === "pause") return { action: "return", result: reviewerResult.result };
  const revStandby = await handleStandbyResult({ stageResult: reviewerResult, session, emitter, eventBase, i, stage: "reviewer", logger, config, askQuestion });
  if (revStandby.handled) {
    if (revStandby.action === "return") return { action: "return", result: revStandby.result };
    if (revStandby.action === "skip") {
      // Solomon said skip review — treat as approved
      return { action: "ok", review: { approved: true, blocking_issues: [], non_blocking_suggestions: [], summary: "Review skipped (agent rate-limited, Solomon approved)", confidence: 0.7 } };
    }
    if (revStandby.action === "retry_reviewer_only") {
      // Retry just the reviewer — use alternative agent if Solomon recommended one
      let retryReviewerRole = reviewerRole;
      const alt = session._alternative_agent;
      if (alt?.stage === "reviewer" && alt?.provider) {
        const { createAgent } = await import("../../agents/index.js");
        retryReviewerRole = { provider: alt.provider, model: null };
        logger.info(`Retrying reviewer with alternative agent: ${alt.provider}`);
        delete session._alternative_agent;
      }
      return runReviewerGateStage({ pipelineFlags: { reviewerEnabled: true }, reviewerRole: retryReviewerRole, config, logger, emitter, eventBase, session, trackBudget, i, reviewRules, task, repeatDetector, budgetSummary, askQuestion });
    }
    return { action: "retry" };
  }
  if (reviewerResult.stalled) return { action: "return", result: reviewerResult.stalledResult };
  return { action: "ok", review: reviewerResult.review };
}

export async function handleApprovedReview({ config, session, emitter, eventBase, coderRole, trackBudget, i, task, stageResults, pipelineFlags, askQuestion, logger, gitCtx, budgetSummary, pgCard, pgProject, review, rtkTracker, brainCtx }) {
  resetRetryCount(session, "reviewer");
  const postLoopResult = await handlePostLoopStages({
    config, session, emitter, eventBase, coderRole, trackBudget, i, task, stageResults,
    ciEnabled: Boolean(config.ci?.enabled), testerEnabled: pipelineFlags.testerEnabled, securityEnabled: pipelineFlags.securityEnabled, askQuestion, logger, brainCtx
  });
  if (postLoopResult.action === "return") return { action: "return", result: postLoopResult.result };
  if (postLoopResult.action === "continue") return { action: "continue" };

  const result = await finalizeApprovedSession({ config, gitCtx, task, logger, session, stageResults, emitter, eventBase, budgetSummary, pgCard, pgProject, review, i, rtkTracker });
  return { action: "return", result };
}



export async function runSingleIteration(ctx) {
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
    }

    // Extended iterations also exhausted — final Solomon call
    const finalResult = await handleMaxIterationsReached({ session: ctx.session, budgetSummary: ctx.budgetSummary, emitter, eventBase: ctx.eventBase, config: ctx.config, stageResults: ctx.stageResults, logger, askQuestion, task: loopTask, rtkTracker: ctx.rtkTracker, brainCtx: ctx.brainCtx });
    return finalResult;
  }

  return maxIterResult;
}

