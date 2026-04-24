// Post-TSK-0335 flow-runner.js is a thin orchestrator: runFlow + resumeFlow.
// Heavy lifting lives under src/orchestrator/drivers/. Imports here reflect
// only what the two top-level entry points still need directly:
//   • session/store.js      — load/save/resume/checkpoint for resumeFlow
//   • utils/events.js       — session:start / session:end / init_error events
//   • solomon-escalation.js — init-error fallback (pre-loop failures)
//   • hu-sub-pipeline.js    — branch: if HU batch → sub-pipeline, else loop
//   • config-init.js        — dry-run handling, pipeline flag resolution,
//                              product-context loader
//   • config/test-harness.js — defensive testHarness resolution for callers
//                               that bypass loadConfig (orchestrator tests)
//   • skills/skill-detector.js — cleanupAutoInstalledSkills on session end
//   • drivers/*             — the extracted pipeline phases
import {
  loadSession,
  markSessionStatus,
  resumeSessionWithAnswer,
  saveSession,
  addCheckpoint,
} from "../session/store.js";
// TSK-0337: session mutations go through the mutators module. Every
// `session.x = y` outside src/session/ should route through one of these
// so grepping the mutator name locates every writer in seconds. See
// tests/architecture/session-write-boundary.test.js for the invariant.
import {
  setStatus, setReviewerFeedback, resetAllRetryCounters,
  setSonarIssueSignature, setReviewerIssueSignature,
  setSonarRepeatCount, setReviewerRepeatCount,
  setBudget,
} from "../session/mutators.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { invokeSolomon } from "./solomon-escalation.js";
import { needsSubPipeline, runHuSubPipeline } from "./hu-sub-pipeline.js";
import {
  loadProductContext, resolvePipelineFlags, handleDryRun,
} from "./config-init.js";
import { resolveTestHarness } from "../config/test-harness.js";
import { cleanupAutoInstalledSkills } from "../skills/skill-detector.js";

// Drivers extracted from this god-module in TSK-0335 (Oleada 3 of the v2.7.4
// audit refactor). Each driver covers one phase of the pipeline; flow-runner
// keeps only the top-level runFlow/resumeFlow orchestration.
//   • drivers/init-context.js   — build the PipelineContext (pre-loop setup)
//   • drivers/iteration-loop.js — the coder→reviewer iteration body
//   • drivers/post-loop.js      — writeHistoryRecord called from resumeFlow
import { initFlowContext } from "./drivers/init-context.js";
import { runIterationLoop } from "./drivers/iteration-loop.js";
import { writeHistoryRecord } from "./drivers/post-loop.js";

// Public re-exports (loadProductContext, shouldAutoContinueCheckpoint,
// parseCheckpointAnswer) live in src/orchestrator.js (the barrel).


// PG card "In Progress" logic moved to src/planning-game/pipeline-adapter.js → initPgAdapter()


export async function runFlow({ task, config, logger, flags = {}, emitter = null, askQuestion = null, pgTaskId = null, pgProject = null }) {
  // Defensive test-harness resolution for callers that bypass loadConfig()
  // (orchestrator unit tests that build raw config objects). Production
  // callers go through src/config/loader.js → loadConfig which already
  // runs resolveTestHarness() once. When config.testHarness is missing we
  // resolve it here using the same contract: explicit field → globalThis →
  // prod defaults. Idempotent — no-op when already present.
  if (config && !config.testHarness) {
    config.testHarness = resolveTestHarness(config.testHarness);
  }
  const pipelineFlags = resolvePipelineFlags(config);

  if (flags.dryRun) {
    return handleDryRun({ task, config, flags, emitter, pipelineFlags });
  }

  let ctx;
  try {
    ctx = await initFlowContext({ task, config, logger, emitter, askQuestion, pgTaskId, pgProject, flags });
  } catch (initError) {
    // Pre-loop stage failure → Solomon decides
    logger.warn(`Init/pre-loop error — escalating to Solomon: ${initError.message}`);
    // tempSession needs `checkpoints` because invokeSolomon → addCheckpoint
    // pushes into it. Pre-v2.7.4 this lacked the array and crashed with
    // "Cannot read properties of undefined (reading 'push')" the moment
    // Solomon was consulted on a preflight failure.
    const tempSession = { id: "init-error", task, status: "failed", checkpoints: [] };
    const solomonResult = await invokeSolomon({
      config, logger, emitter, eventBase: { sessionId: "init-error", iteration: 0, stage: "init", startedAt: Date.now() },
      stage: "init_error", askQuestion, session: tempSession, iteration: 0,
      conflict: {
        stage: "init_error",
        task,
        iterationCount: 0,
        maxIterations: config.max_iterations || 5,
        history: [{ agent: "pipeline", feedback: `Initialization failed: ${initError.message}` }]
      }
    });
    if (solomonResult.action === "pause") {
      return { paused: true, sessionId: "init-error", question: solomonResult.question, context: "init_error" };
    }
    throw initError; // Solomon couldn't resolve — propagate
  }

  try {
    // --- Analysis-only flow: skip coder/reviewer when coderRequired === false ---
    if (ctx.pipelineFlags.coderRequired === false) {
      logger.info("Analysis-only task — skipping coder/reviewer iteration loop");
      emitProgress(emitter, makeEvent("pipeline:analysis-only", { ...ctx.eventBase, stage: "analysis" }, {
        message: "Analysis-only task — running security and audit stages only",
        detail: { taskType: ctx.session.resolved_policies?.taskType, coderRequired: false }
      }));

      const analysisStageResults = ctx.stageResults;
      const postLoopDiff = await generateDiff({ baseRef: ctx.session.session_start_sha });

      if (ctx.pipelineFlags.securityEnabled) {
        const securityResult = await runSecurityStage({
          config: ctx.config, logger, emitter, eventBase: ctx.eventBase, session: ctx.session,
          coderRole: ctx.coderRole, trackBudget: ctx.trackBudget,
          iteration: 1, task: ctx.plannedTask, diff: postLoopDiff, askQuestion, brainCtx: ctx.brainCtx
        });
        if (securityResult.stageResult) analysisStageResults.security = securityResult.stageResult;
      }

      const auditResult = await runFinalAuditStage({
        config: ctx.config, logger, emitter, eventBase: ctx.eventBase, session: ctx.session,
        coderRole: ctx.coderRole, trackBudget: ctx.trackBudget,
        iteration: 1, task: ctx.plannedTask, diff: postLoopDiff
      });
      if (auditResult.stageResult) analysisStageResults.audit = auditResult.stageResult;

      setBudget(ctx.session, ctx.budgetSummary());
      await markSessionStatus(ctx.session, "approved");

      const analysisResult = {
        approved: true,
        sessionId: ctx.session.id,
        analysisOnly: true,
        stages: analysisStageResults,
        budget: ctx.budgetSummary()
      };
      await writeHistoryRecord({ sessionId: ctx.session.id, task, result: analysisResult, logger });

      emitProgress(emitter, makeEvent("session:end", { ...ctx.eventBase, stage: "done" }, {
        message: "Analysis-only session completed",
        detail: analysisResult
      }));

      return analysisResult;
    }

    // --- HU Sub-Pipeline: run each certified HU as an independent iteration loop ---
    if (needsSubPipeline(ctx.stageResults.huReviewer)) {
      logger.info(`HU sub-pipeline: ${ctx.stageResults.huReviewer.certified} certified stories — running each as a sub-pipeline`);
      emitProgress(emitter, makeEvent("hu:sub-pipeline:start", { ...ctx.eventBase, stage: "hu-sub-pipeline" }, {
        message: `Running ${ctx.stageResults.huReviewer.certified} HUs as sub-pipelines`,
        detail: { total: ctx.stageResults.huReviewer.total, certified: ctx.stageResults.huReviewer.certified }
      }));

      // Per-HU pipeline: focused max_iterations, fresh Brain state, own git branch.
      const originalMaxIterations = ctx.config.max_iterations;
      const huMaxIterations = ctx.config.hu_max_iterations ?? 3;
      const huBranches = new Map();
      const { prepareHuBranch, finalizeHuCommit } = await import("../git/hu-automation.js");
      const subPipelineResult = await runHuSubPipeline({
        huReviewerResult: ctx.stageResults.huReviewer,
        runIterationFn: async (huTask, story) => {
          ctx.config.max_iterations = huMaxIterations;
          if (ctx.brainCtx?.enabled) {
            ctx.brainCtx.extensionCount = 0;
            const { createBrainContext } = await import("./brain-coordinator.js");
            const fresh = createBrainContext({ enabled: true });
            ctx.brainCtx.feedbackQueue = fresh.feedbackQueue;
            ctx.brainCtx.verificationTracker = fresh.verificationTracker;
          }
          // Apply per-HU policies based on task_type (infra skips reviewer/sonar/tdd)
          const { applyPolicies } = await import("../guards/policy-resolver.js");
          const huPolicies = applyPolicies({ taskType: story.task_type, policies: ctx.config.policies });
          const savedFlags = { ...ctx.pipelineFlags };
          if (!huPolicies.reviewer) ctx.pipelineFlags.reviewerEnabled = false;
          if (!huPolicies.tdd) ctx.config.development = { ...ctx.config.development, methodology: "standard", require_test_changes: false };
          if (!huPolicies.sonar) ctx.config.sonarqube = { ...ctx.config.sonarqube, enabled: false };
          if (!huPolicies.testsRequired) ctx.pipelineFlags.testerEnabled = false;
          logger.info(`HU ${story.id} (${story.task_type}): policies → reviewer=${huPolicies.reviewer}, tdd=${huPolicies.tdd}, sonar=${huPolicies.sonar}, tests=${huPolicies.testsRequired}`);

          const branchName = await prepareHuBranch({ story, huBranches, config: ctx.config, logger });
          const projectDir = ctx.config.projectDir || process.cwd();

          // If HU has acceptance_tests, Brain runs them as the gate instead of
          // the standard reviewer/tester pipeline. This is the radical fix:
          // concrete executable tests replace subjective reviewer opinions.
          if (story.acceptance_tests?.length > 0) {
            const { runAcceptanceTests, buildDiagnosticPrompt } = await import("../hu/acceptance-runner.js");

            for (let attempt = 1; attempt <= ctx.config.max_iterations; attempt++) {
              logger.info(`HU ${story.id}: coder iteration ${attempt}/${ctx.config.max_iterations}`);
              emitProgress(emitter, makeEvent("iteration:start", { ...ctx.eventBase, stage: "iteration" }, {
                message: `Iteration ${attempt}/${ctx.config.max_iterations}`,
                detail: { iteration: attempt, maxIterations: ctx.config.max_iterations }
              }));

              // Coder runs with the HU task + any diagnostic feedback from previous attempt
              const coderResult = await runCoderStage({
                coderRoleInstance: ctx.coderRoleInstance, coderRole: ctx.coderRole,
                config: ctx.config, logger, emitter, eventBase: ctx.eventBase,
                session: ctx.session, plannedTask: ctx.plannedTask,
                trackBudget: ctx.trackBudget, iteration: attempt, brainCtx: ctx.brainCtx
              });
              if (coderResult?.action === "standby" || coderResult?.action === "pause") {
                return coderResult?.result || { approved: false, reason: "coder_failed" };
              }

              // Sonar quality gate (sw task_type only, when policies say sonar=true)
              if (huPolicies.sonar && ctx.config.sonarqube?.enabled) {
                try {
                  const sonarResult = await runSonarStage({
                    config: ctx.config, logger, emitter, eventBase: ctx.eventBase,
                    session: ctx.session, trackBudget: ctx.trackBudget, iteration: attempt,
                    askQuestion, brainCtx: ctx.brainCtx
                  });
                  if (sonarResult?.action === "continue") {
                    // Sonar failed — add to feedback for next coder attempt
                    ctx.plannedTask = `${huTask}\n\n--- SONAR FAILURE ---\n${ctx.session.last_reviewer_feedback}`;
                    continue;
                  }
                } catch (err) {
                  logger.warn(`HU ${story.id}: sonar stage failed (non-blocking): ${err.message}`);
                }
              }

              // Brain runs acceptance tests
              logger.info(`HU ${story.id}: running ${story.acceptance_tests.length} acceptance tests`);
              emitProgress(emitter, makeEvent("hu:acceptance-start", { ...ctx.eventBase, stage: "acceptance" }, {
                message: `Running ${story.acceptance_tests.length} acceptance tests`,
                detail: { huId: story.id, testCount: story.acceptance_tests.length }
              }));

              const testResult = await runAcceptanceTests(story.acceptance_tests, projectDir);
              emitProgress(emitter, makeEvent("hu:acceptance-end", { ...ctx.eventBase, stage: "acceptance" }, {
                status: testResult.allPassed ? "ok" : "fail",
                message: testResult.summary,
                detail: { allPassed: testResult.allPassed, results: testResult.results.map(r => ({ cmd: r.cmd, passed: r.passed })) }
              }));

              if (testResult.allPassed) {
                logger.info(`HU ${story.id}: all acceptance tests PASSED — approved`);
                await finalizeHuCommit({ story, branchName, config: ctx.config, logger });
                return { approved: true, sessionId: ctx.session.id, reason: "acceptance_tests_passed" };
              }

              // Brain diagnoses failures and sends concrete fix to coder
              const failed = testResult.results.filter(r => !r.passed);
              const diagnostic = buildDiagnosticPrompt(failed);
              logger.warn(`HU ${story.id}: ${failed.length} acceptance test(s) FAILED — sending diagnostic to coder`);
              setReviewerFeedback(ctx.session, diagnostic);
              ctx.plannedTask = `${huTask}\n\n--- ACCEPTANCE TEST FAILURES ---\n${diagnostic}`;
            }

            // All iterations exhausted
            logger.warn(`HU ${story.id}: max iterations reached with acceptance tests still failing`);
            return { approved: false, sessionId: ctx.session.id, reason: "acceptance_tests_failed" };
          }

          // Fallback: no acceptance_tests → standard pipeline (reviewer/tester)
          try {
            const result = await runIterationLoop(ctx, { task: huTask, askQuestion, emitter, logger });
            if (result?.approved) {
              await finalizeHuCommit({ story, branchName, config: ctx.config, logger });
            }
            return result;
          } finally {
            ctx.config.max_iterations = originalMaxIterations;
            Object.assign(ctx.pipelineFlags, savedFlags);
          }
        },
        emitter,
        eventBase: ctx.eventBase,
        logger,
        config: ctx.config
      });

      emitProgress(emitter, makeEvent("hu:sub-pipeline:end", { ...ctx.eventBase, stage: "hu-sub-pipeline" }, {
        status: subPipelineResult.approved ? "ok" : "fail",
        message: subPipelineResult.approved
          ? "All HUs completed successfully"
          : `Sub-pipeline finished with failures (${subPipelineResult.blockedIds.length} blocked)`,
        detail: { results: subPipelineResult.results, blockedIds: subPipelineResult.blockedIds }
      }));

      // Sync results back to plan file if this was a plan-based run
      if (ctx.session._syncResultsToPlan) {
        try {
          await ctx.session._syncResultsToPlan(subPipelineResult);
          logger.info("Plan updated with execution results");
        } catch (err) {
          logger.warn(`Failed to sync results to plan: ${err.message}`);
        }
      }

      const finalResult = {
        approved: subPipelineResult.approved,
        sessionId: ctx.session.id,
        huResults: subPipelineResult.results,
        blockedIds: subPipelineResult.blockedIds,
        planId: ctx.session._planRef?.planId || null
      };
      await writeHistoryRecord({ sessionId: ctx.session.id, task, result: finalResult, logger });
      return finalResult;
    }

    // --- Standard single-task pipeline (1 HU or no HU reviewer) ---
    const result = await runIterationLoop(ctx, { task: ctx.plannedTask, askQuestion, emitter, logger });
    await writeHistoryRecord({ sessionId: ctx.session.id, task, result, logger });
    return result;
  } finally {
    // --- Cleanup auto-installed skills ---
    const autoSkills = ctx.session?.autoInstalledSkills;
    if (autoSkills && autoSkills.length > 0) {
      const cleanProjectDir = ctx.config?.projectDir || process.cwd();
      try {
        const cleanupResult = await cleanupAutoInstalledSkills(autoSkills, cleanProjectDir);
        if (cleanupResult.removed.length > 0) {
          logger.info(`Cleaned up ${cleanupResult.removed.length} auto-installed skill(s): ${cleanupResult.removed.join(", ")}`);
        }
      } catch (err) {
        logger.warn(`Skill cleanup failed (non-blocking): ${err.message}`);
      }
    }

    // --- Telemetry: anonymous pipeline_complete event (non-blocking) ---
    try {
      const { sendTelemetryEvent } = await import("../utils/telemetry.js");
      const durationS = Math.round((Date.now() - ctx.startedAt) / 1000);
      const sessionStatus = ctx.session?.status || "unknown";
      sendTelemetryEvent("pipeline_complete", {
        mode: config.review_mode,
        agent: ctx.coderRole?.provider || config.coder,
        duration_s: durationS,
        success: sessionStatus === "approved",
        taskType: ctx.session?.resolved_policies?.taskType || null
      }, config).catch(() => {});
    } catch { /* non-blocking */ }
  }
}

export async function resumeFlow({ sessionId, answer, config, logger, flags = {}, emitter = null, askQuestion = null }) {
  const session = answer
    ? await resumeSessionWithAnswer(sessionId, answer)
    : await loadSession(sessionId);

  if (session.status === "paused" && !answer) {
    logger.info(`Session ${sessionId} is paused. Provide --answer to resume.`);
    return session;
  }

  // Allow resuming "stopped" sessions (checkpoint stop) and "failed" sessions
  const resumableStatuses = new Set(["running", "stopped", "failed"]);
  if (!resumableStatuses.has(session.status)) {
    logger.info(`Session ${sessionId} has status ${session.status} — not resumable`);
    return session;
  }

  // Mark as running again for stopped/failed sessions
  if (session.status !== "running") {
    logger.info(`Resuming ${session.status} session ${sessionId}`);
    setStatus(session, "running");
    await saveSession(session);
  }

  // Session was paused and now resumed with answer - re-run the flow
  const task = session.task;
  const sessionConfig = config || session.config_snapshot;
  if (!sessionConfig) {
    throw new Error("No config available to resume session");
  }

  logger.info(`Resuming session ${sessionId} with answer: ${answer}`);

  // Inject the answer as additional feedback for the coder
  if (session.paused_state?.context?.lastFeedback) {
    setReviewerFeedback(session, `Previous feedback: ${session.paused_state.context.lastFeedback}\nUser guidance: ${answer}`);
  }
  resetAllRetryCounters(session);
  setSonarIssueSignature(session, null);
  setSonarRepeatCount(session, 0);
  setReviewerIssueSignature(session, null);
  setReviewerRepeatCount(session, 0);
  await saveSession(session);

  // Re-run the flow with the existing session context
  try {
    return await runFlow({ task, config: sessionConfig, logger, flags, emitter, askQuestion });
  } catch (err) {
    await markSessionStatus(session, "failed");
    throw err;
  }
}
