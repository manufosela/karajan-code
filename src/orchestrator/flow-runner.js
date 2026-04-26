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
import { withRunContext } from "./run-context.js";
import { ensureTrackerRegistered } from "../tracker-bootstrap.js";

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


export async function runFlow(opts) {
  // TSK-0338: isolate per-run state (git/diff runner, projectDir, snapshot)
  // inside an AsyncLocalStorage scope. Two concurrent `runFlow` invocations
  // (MCP multi-client) no longer contaminate each other's module state.
  // initFlowContext writes into this store (see drivers/init-context.js).
  return withRunContext({}, () => _runFlowInner(opts));
}

async function _runFlowInner({ task, config, logger, flags = {}, emitter = null, askQuestion = null, pgTaskId = null, pgProject = null }) {
  // Defensive test-harness resolution for callers that bypass loadConfig()
  // (orchestrator unit tests that build raw config objects). Production
  // callers go through src/config/loader.js → loadConfig which already
  // runs resolveTestHarness() once. When config.testHarness is missing we
  // resolve it here using the same contract: explicit field → globalThis →
  // prod defaults. Idempotent — no-op when already present.
  if (config && !config.testHarness) {
    config.testHarness = resolveTestHarness(config.testHarness);
  }

  // TSK-0339: delegate tracker registration to the neutral bootstrap
  // module so `src/orchestrator/` never imports a tracker directly.
  // Idempotent — no-op if the adapter is already registered (which is the
  // steady state once the real `src/bootstrap.js::ensureBootstrap` has
  // run; orchestrator unit tests that skip bootstrap benefit from this
  // lazy fallback).
  await ensureTrackerRegistered(config);

  // Auto-GC: prune orphan plans and old finalised state so `~/.kj/` and
  // `~/.karajan/` don't accumulate forever. Silent unless something was
  // removed; stderr one-liner on cleanup. Skipped in test env.
  if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
    try {
      const { runAutoGC, summarizeGC } = await import("../utils/garbage-collector.js");
      const gcResult = await runAutoGC();
      const summary = summarizeGC(gcResult);
      if (summary) process.stderr.write(`${summary}\n`);
    } catch (err) {
      logger?.warn?.(`Auto-GC failed (non-blocking): ${err.message}`);
    }
  }

  const pipelineFlags = resolvePipelineFlags(config);

  if (flags.dryRun) {
    return handleDryRun({ task, config, flags, emitter, pipelineFlags });
  }

  let ctx;
  try {
    ctx = await initFlowContext({ task, config, logger, emitter, askQuestion, pgTaskId, pgProject, flags });
  } catch (initError) {
    // Pre-loop / preflight failures are CONFIG problems, not pipeline
    // disputes. Pre-v2.7.5 we escalated them to Solomon, which:
    //   1. Spent tokens on something an LLM can't actually fix (e.g.
    //      "port 9000 occupied", "docker not installed", "node version
    //      too old"). Solomon's job is to mediate between coder and
    //      reviewer, not to rewrite the user's environment.
    //   2. Often failed to parse its own output ("Failed to parse
    //      Solomon output: no JSON found") and then asked the user a
    //      garbled multi-line "Conflict: init_error" prompt — useless
    //      when the run was launched by the board's ▶ Run plan with
    //      stdio=ignore, since there's nobody to answer it.
    //
    // New behaviour: print the error verbatim with the actionable fix
    // (the preflight check already attached one), emit init_error
    // through the event channel for tooling, and bail with a non-zero
    // exit. The user gets one clear message and a fix; nothing tries to
    // be cleverer than that.
    logger.error(`Initialization failed: ${initError.message}`);
    if (initError.fix) logger.error(`  Fix: ${initError.fix}`);
    emitProgress(emitter, makeEvent("init:failed", {
      sessionId: "init-error", iteration: 0, stage: "init", startedAt: Date.now()
    }, {
      status: "fail",
      message: `Initialization failed: ${initError.message}`,
      detail: { error: initError.message, fix: initError.fix || null }
    }));
    throw initError;
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

      // PR F (v2.7.5): the per-HU loop needs three pieces of plan context:
      //   • ADRs (loaded once from disk, applies to every HU on this plan)
      //   • the plan-reviewer findings (rides on the huBatch)
      //   • each HU's spec_section (rides on the story)
      // Loading ADRs once outside the loop avoids hitting the filesystem
      // per-HU. When the plan never went through `kj plan` (legacy
      // auto-generated batch), planId is null → loadActiveAdrs falls back
      // to the "_loose" bucket and returns [] silently.
      const planId = ctx.stageResults.huReviewer.planId || null;
      const reviewerFindings = ctx.stageResults.huReviewer.review || null;
      let planAdrs = [];
      try {
        const { loadActiveAdrs } = await import("../plan/adr-loader.js");
        planAdrs = await loadActiveAdrs(ctx.config.projectDir || process.cwd(), planId);
        if (planAdrs.length > 0) {
          logger.info(`Plan ${planId || "(loose)"}: loaded ${planAdrs.length} ADR(s) for coder context`);
        }
      } catch (err) {
        logger.warn(`ADR loader failed (non-blocking): ${err.message}`);
      }

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

              // Coder runs with the HU task + any diagnostic feedback from previous attempt.
              // Phase 2 of tests-first (v2.7.5): also hand over the declared
              // acceptance_tests so the coder has the contract from turn 1,
              // not only after the first failed run.
              const coderResult = await runCoderStage({
                coderRoleInstance: ctx.coderRoleInstance, coderRole: ctx.coderRole,
                config: ctx.config, logger, emitter, eventBase: ctx.eventBase,
                session: ctx.session, plannedTask: ctx.plannedTask,
                trackBudget: ctx.trackBudget, iteration: attempt, brainCtx: ctx.brainCtx,
                acceptanceTests: story.acceptance_tests,
                // PR F (v2.7.5): plan-aware coder context. ADRs are
                // shared across the plan, the rest are scoped to this
                // HU. buildCoderPrompt skips any section whose data is
                // null/empty so legacy paths render the same prompt.
                adrs: planAdrs,
                specSection: story.spec_section || null,
                reviewerFindings,
                huId: story.id
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
                // Phase 3 of tests-first (v2.7.5): the shell gate is green,
                // but any Gherkin scenarios are still "pending" — they need
                // the tester to translate them into real test files before
                // we can call the HU done. If none are pending, approve
                // immediately like before.
                const pendingGherkinTests = (story.acceptance_tests || []).filter(
                  (t) => t && typeof t === "object" && t.type === "gherkin"
                );
                if (pendingGherkinTests.length === 0) {
                  logger.info(`HU ${story.id}: all shell acceptance tests PASSED, no Gherkin to translate — approved`);
                  await finalizeHuCommit({ story, branchName, config: ctx.config, logger });
                  return { approved: true, sessionId: ctx.session.id, reason: "acceptance_tests_passed" };
                }

                // Shell tests passed; Gherkin needs translation. Invoke the
                // tester with both so it writes code tests for the Gherkin,
                // runs the suite, and returns verdict.
                logger.info(`HU ${story.id}: shell gate passed, asking tester to translate ${pendingGherkinTests.length} Gherkin scenario(s)`);
                const { runTesterStage } = await import("./post-loop-stages.js");
                const shellResults = testResult.results.filter((r) => r.type !== "gherkin");
                const testerOutcome = await runTesterStage({
                  config: ctx.config, logger, emitter, eventBase: ctx.eventBase,
                  session: ctx.session, coderRole: ctx.coderRole, trackBudget: ctx.trackBudget,
                  iteration: attempt, task: huTask, diff: null, askQuestion,
                  pendingGherkinTests, shellTestResults: shellResults,
                });
                const testerStage = testerOutcome?.stageResult;
                if (testerOutcome?.action !== "continue" && testerStage?.verdict === "pass") {
                  logger.info(`HU ${story.id}: tester translated Gherkin and verdict=pass — approved`);
                  await finalizeHuCommit({ story, branchName, config: ctx.config, logger });
                  return { approved: true, sessionId: ctx.session.id, reason: "acceptance_tests_passed" };
                }

                // Tester rejected (translated tests failed or coverage
                // inadequate). Feed its diagnostic back to the coder for
                // another iteration.
                const failing = testerStage?.failing_scenarios?.join("\n- ") || testerStage?.summary || "tester rejected";
                const diagnostic = [
                  "Tester translated the Gherkin acceptance tests and some FAILED:",
                  failing ? `- ${failing}` : "",
                  "",
                  "Fix the implementation so every scenario passes. Do NOT soften the scenarios.",
                ].filter(Boolean).join("\n");
                logger.warn(`HU ${story.id}: tester verdict=fail after Gherkin translation — sending back to coder`);
                setReviewerFeedback(ctx.session, diagnostic);
                ctx.plannedTask = `${huTask}\n\n--- GHERKIN TRANSLATION FAILURES ---\n${diagnostic}`;
                continue;
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
        config: ctx.config,
        // PR1 (live HU status): forward the per-HU status updater so
        // hu-sub-pipeline can patch the plan JSON on every transition,
        // not only at the end of the run. The board's chokidar then
        // fires per-HU and the Kanban columns update in real time.
        onStatusChange: ctx.session?._liveStatusUpdater || null
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
