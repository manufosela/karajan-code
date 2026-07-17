/**
 * HU sub-pipeline driver — extracted from flow-runner.js in PR-L
 * (audit follow-up). Was 244 LOC inlined inside _runFlowInner, the
 * second-worst long-function per `kj audit`.
 *
 * Behaviour identical to the inlined version — the closure passed to
 * runHuSubPipeline is moved verbatim, only its surrounding context
 * (logger, emitter, ctx, askQuestion) becomes function parameters.
 *
 * The extraction also fixes a latent bug: flow-runner.js called
 * `runCoderStage`, `runSonarStage`, `generateDiff` and
 * `runSecurityStage` without static OR dynamic imports. Those
 * references would ReferenceError at runtime on the HU sub-pipeline
 * path; the fact that no test caught it suggests the path was rarely
 * exercised end-to-end (preflight failures often abort earlier).
 * This module imports them explicitly.
 *
 * Returns:
 *   - { handled: true, result } — needsSubPipeline matched; caller
 *     must short-circuit and return `result`.
 *   - { handled: false } — caller falls through to the standard
 *     single-task pipeline (runIterationLoop).
 */

import { emitProgress, makeEvent } from "../../utils/events.js";
import { needsSubPipeline, runHuSubPipeline } from "../hu-sub-pipeline.js";
import { runCoderStage } from "../stages/coder-stage.js";
import { runSonarStage } from "../stages/sonar-stage.js";
import { runIterationLoop } from "./iteration-loop.js";
import { classifyFailure, createFailureTracker } from "../repair/repair-detector.js";
import { runRepair } from "../repair/repair-runner.js";
import { writeHistoryRecord } from "./post-loop.js";
import { setReviewerFeedback } from "../../session/mutators.js";
import { createHuSnapshot } from "../../git/hu-snapshot.js";

/**
 * @param {object} args
 * @param {object} args.ctx          — PipelineContext from initFlowContext
 * @param {string} args.task         — original task description (for writeHistoryRecord)
 * @param {object} args.askQuestion
 * @param {object} args.emitter
 * @param {object} args.logger
 * @returns {Promise<{handled: boolean, result?: object}>}
 */
export async function runHuBatch({ ctx, task, askQuestion, emitter, logger }) {
  if (!needsSubPipeline(ctx.stageResults.huReviewer)) {
    return { handled: false };
  }

      // --- HU Sub-Pipeline: run each certified HU as an independent iteration loop ---
  logger.info(`HU sub-pipeline: ${ctx.stageResults.huReviewer.certified} certified stories — running each as a sub-pipeline`);
  emitProgress(emitter, makeEvent("hu:sub-pipeline:start", { ...ctx.eventBase, stage: "hu-sub-pipeline" }, {
    message: `Running ${ctx.stageResults.huReviewer.certified} HUs as sub-pipelines`,
    detail: { total: ctx.stageResults.huReviewer.total, certified: ctx.stageResults.huReviewer.certified }
  }));

  // Per-HU pipeline: focused max_iterations, fresh Brain state, own git branch.
  const huMaxIterations = ctx.config.hu_max_iterations ?? 3;
  const huBranches = new Map();
  const { prepareHuBranch, finalizeHuCommit } = await import("../../git/hu-automation.js");

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
    const { loadActiveAdrs } = await import("../../plan/adr-loader.js");
    planAdrs = await loadActiveAdrs(ctx.config.projectDir || process.cwd(), planId);
    if (planAdrs.length > 0) {
      logger.info(`Plan ${planId || "(loose)"}: loaded ${planAdrs.length} ADR(s) for coder context`);
    }
  } catch (err) {
    logger.warn(`ADR loader failed (non-blocking): ${err.message}`);
  }

  const subPipelineResult = await runHuSubPipeline({
    huReviewerResult: ctx.stageResults.huReviewer,
    runIterationFn: async (huTask, story, laneOpts = {}) => {
      // Apply per-HU policies based on task_type (infra skips reviewer/sonar/tdd).
      // KJC-TSK-0400: `effectiveTaskType` mira primero story.task_type y, si
      // no es válido, infiere del prefijo del title ([SPIKE], [DOC]…). Así
      // un HU con title "[SPIKE] Decidir auth" entra automáticamente a las
      // policies de spike (sin Sonar/TDD/tests).
      const { applyPolicies, effectiveTaskType } = await import("../../guards/policy-resolver.js");
      const resolvedTaskType = effectiveTaskType(story);
      if (resolvedTaskType !== story.task_type) {
        logger.info(`HU ${story.id}: task_type inferido del title → ${resolvedTaskType} (era ${story.task_type || "null"})`);
      }
      const huPolicies = applyPolicies({ taskType: resolvedTaskType, policies: ctx.config.policies });
      logger.info(`HU ${story.id} (${resolvedTaskType}): policies → reviewer=${huPolicies.reviewer}, tdd=${huPolicies.tdd}, sonar=${huPolicies.sonar}, tests=${huPolicies.testsRequired}`);

      // PAR-E2 PR2 (KJC-TSK-0629): every per-HU adjustment lands on LANE
      // copies. ctx.config/pipelineFlags/session/brainCtx are shared by all
      // lanes, so concurrent lanes must never mutate them. This also fixes a
      // latent leak: max_iterations was mutated on ctx.config and only the
      // fallback path restored it — the acceptance path returned early and
      // left it clamped to hu_max_iterations for the rest of the run.
      const worktreePath = laneOpts?.worktreePath || null;
      const projectDir = worktreePath || ctx.config.projectDir || process.cwd();
      const laneConfig = { ...ctx.config, projectDir, max_iterations: huMaxIterations };
      if (!huPolicies.tdd) laneConfig.development = { ...laneConfig.development, methodology: "standard", require_test_changes: false };
      if (!huPolicies.sonar) laneConfig.sonarqube = { ...laneConfig.sonarqube, enabled: false };
      const laneFlags = { ...ctx.pipelineFlags };
      if (!huPolicies.reviewer) laneFlags.reviewerEnabled = false;
      if (!huPolicies.testsRequired) laneFlags.testerEnabled = false;
      // Worktree lanes clone the session so reviewer feedback never leaks
      // across concurrent HUs. Disk saves still share the session id (last
      // writer wins) — journal noise at most; in-memory isolation is what
      // guards correctness.
      const laneSession = worktreePath ? { ...ctx.session } : ctx.session;
      let laneBrain = ctx.brainCtx;
      if (ctx.brainCtx?.enabled) {
        const { createBrainContext } = await import("../brain-coordinator.js");
        const fresh = createBrainContext({ enabled: true });
        if (worktreePath) {
          laneBrain = { ...ctx.brainCtx, extensionCount: 0, feedbackQueue: fresh.feedbackQueue, verificationTracker: fresh.verificationTracker };
        } else {
          ctx.brainCtx.extensionCount = 0;
          ctx.brainCtx.feedbackQueue = fresh.feedbackQueue;
          ctx.brainCtx.verificationTracker = fresh.verificationTracker;
        }
      }
      let lanePlannedTask = ctx.plannedTask;

      // A worktree lane skips the main-tree checkout: `git worktree add -b`
      // already left the worktree checked out on kj-hu-<id>.
      let branchName;
      if (worktreePath) {
        branchName = `kj-hu-${story.id}`;
        huBranches.set(story.id, branchName);
      } else {
        branchName = await prepareHuBranch({ story, huBranches, config: laneConfig, logger });
      }

      // KJC-TSK-0408 step 2: snapshot del workspace ANTES de invocar al
      // coder. Si el usuario hace Undo después, restaura este SHA. El
      // ref se crea sobre el HEAD ya checkouteado a la rama de la HU,
      // así que apunta al estado limpio sobre el que el coder empieza.
      // Idempotente — si la HU ya tenía snapshot, se sobreescribe.
      try {
        const snap = await createHuSnapshot({ projectDir, huId: story.id });
        if (snap.ok) {
          story.outcome = { ...(story.outcome || {}), snapshot_sha: snap.sha, snapshot_ref: snap.ref };
          logger.info(`HU ${story.id}: snapshot ${snap.sha.slice(0, 7)} (ref ${snap.ref})`);
        } else {
          logger.warn(`HU ${story.id}: snapshot falló (non-blocking): ${snap.error}`);
        }
      } catch (err) {
        logger.warn(`HU ${story.id}: snapshot threw (non-blocking): ${err.message}`);
      }

      // If HU has acceptance_tests, Brain runs them as the gate instead of
      // the standard reviewer/tester pipeline. This is the radical fix:
      // concrete executable tests replace subjective reviewer opinions.
      if (story.acceptance_tests?.length > 0) {
        const { runAcceptanceTests, buildDiagnosticPrompt } = await import("../../hu/acceptance-runner.js");
        // Issue #538 — Repairer runtime safety net. The tracker remembers
        // each test's last failure signature; classifyFailure flags
        // structural bugs (broken jq, shell parse error, missing tool)
        // after 2 consecutive identical failures so we don't burn 5
        // iterations against an irreparable test (the 2026-04-29 bug).
        const failureTracker = createFailureTracker();

        for (let attempt = 1; attempt <= laneConfig.max_iterations; attempt++) {
          logger.info(`HU ${story.id}: coder iteration ${attempt}/${laneConfig.max_iterations}`);
          emitProgress(emitter, makeEvent("iteration:start", { ...ctx.eventBase, stage: "iteration" }, {
            message: `Iteration ${attempt}/${laneConfig.max_iterations}`,
            detail: { iteration: attempt, maxIterations: laneConfig.max_iterations }
          }));

          // Coder runs with the HU task + any diagnostic feedback from previous attempt.
          // Phase 2 of tests-first (v2.7.5): also hand over the declared
          // acceptance_tests so the coder has the contract from turn 1,
          // not only after the first failed run.
          const coderResult = await runCoderStage({
            coderRoleInstance: ctx.coderRoleInstance, coderRole: ctx.coderRole,
            config: laneConfig, logger, emitter, eventBase: ctx.eventBase,
            session: laneSession, plannedTask: lanePlannedTask,
            trackBudget: ctx.trackBudget, iteration: attempt, brainCtx: laneBrain,
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
          if (huPolicies.sonar && laneConfig.sonarqube?.enabled) {
            try {
              const sonarResult = await runSonarStage({
                config: laneConfig, logger, emitter, eventBase: ctx.eventBase,
                session: laneSession, trackBudget: ctx.trackBudget, iteration: attempt,
                // sonarState is required: runSonarStage reads/writes
                // .issuesInitial / .issuesFinal on it. Forgetting this
                // surfaces as `Cannot read properties of undefined
                // (reading 'issuesInitial')` and the catch below swallows
                // it as "sonar stage failed (non-blocking)" — the gate
                // never actually runs for the HU, every iteration burns
                // budget for nothing. Mirrors iteration-loop.js.
                sonarState: ctx.sonarState,
                repeatDetector: ctx.repeatDetector,
                budgetSummary: ctx.budgetSummary,
                askQuestion, brainCtx: laneBrain
              });
              if (sonarResult?.action === "continue") {
                // Sonar failed — add to feedback for next coder attempt
                lanePlannedTask = `${huTask}\n\n--- SONAR FAILURE ---\n${laneSession.last_reviewer_feedback}`;
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
              await finalizeHuCommit({ story, branchName, config: laneConfig, logger, cwd: worktreePath });
              return { approved: true, sessionId: laneSession.id, reason: "acceptance_tests_passed" };
            }

            // Shell tests passed; Gherkin needs translation. Invoke the
            // tester with both so it writes code tests for the Gherkin,
            // runs the suite, and returns verdict.
            logger.info(`HU ${story.id}: shell gate passed, asking tester to translate ${pendingGherkinTests.length} Gherkin scenario(s)`);
            const { runTesterStage } = await import("../post-loop-stages.js");
            const shellResults = testResult.results.filter((r) => r.type !== "gherkin");
            const testerOutcome = await runTesterStage({
              config: laneConfig, logger, emitter, eventBase: ctx.eventBase,
              session: laneSession, coderRole: ctx.coderRole, trackBudget: ctx.trackBudget,
              iteration: attempt, task: huTask, diff: null, askQuestion,
              pendingGherkinTests, shellTestResults: shellResults,
            });
            const testerStage = testerOutcome?.stageResult;
            if (testerOutcome?.action !== "continue" && testerStage?.verdict === "pass") {
              logger.info(`HU ${story.id}: tester translated Gherkin and verdict=pass — approved`);
              await finalizeHuCommit({ story, branchName, config: laneConfig, logger, cwd: worktreePath });
              return { approved: true, sessionId: laneSession.id, reason: "acceptance_tests_passed" };
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
            setReviewerFeedback(laneSession, diagnostic);
            lanePlannedTask = `${huTask}\n\n--- GHERKIN TRANSLATION FAILURES ---\n${diagnostic}`;
            continue;
          }

          // Brain diagnoses failures and sends concrete fix to coder
          const failed = testResult.results.filter(r => !r.passed);

          // Repairer (#538): for each failing shell test, see if it's been
          // failing the same way 2× in a row AND looks structurally broken
          // (jq syntax, shell parse error, missing tool, etc.). If yes,
          // invoke RepairerRole to rewrite the test in the plan + batch
          // before iterating again. If unfixable, escalate (fail the HU
          // immediately rather than burn the rest of max_iterations).
          let repairedAny = false;
          let repairEscalate = null;
          for (const f of failed) {
            if (f.type !== "shell") continue;
            const consecutive = failureTracker.record(f.cmd, f.output);
            const cls = classifyFailure({
              cmd: f.cmd, errorOutput: f.output, consecutive,
            });
            if (!cls.infeasible) continue;
            const testIndex = story.acceptance_tests.findIndex((t) => {
              const c = typeof t === "object" ? t.content : t;
              return c === f.cmd;
            });
            if (testIndex < 0) continue;
            // Mutate `story.acceptance_tests` in place. The same story
            // reference lives inside runHuSubPipeline's batch (passed
            // by ref), so the next iteration's acceptance runner sees
            // the fixed test without us needing batch+batchSessionId
            // in this scope. The reconcile from PR #544 will sync the
            // plan JSON on the next run.
            const repair = await runRepair({
              story, testIndex, errorOutput: f.output,
              batchSessionId: ctx.stageResults.huReviewer.batchSessionId,
              // batch unavailable in this closure scope — runRepair
              // gates saveHuBatch on its presence and skips when
              // missing; the in-memory mutation alone is sufficient
              // for the next acceptance run within this same HU loop.
              batch: null,
              config: ctx.config, logger, emitter, eventBase: ctx.eventBase,
              failureKind: cls.kind,
              savePlanPatch: null,
            });
            if (repair.escalate) { repairEscalate = repair.reason; break; }
            if (repair.repaired) {
              repairedAny = true;
              failureTracker.reset(f.cmd);
            }
          }

          if (repairEscalate) {
            logger.warn(`HU ${story.id}: Repairer escalated — ${repairEscalate}`);
            return { approved: false, sessionId: laneSession.id, reason: "repair_escalated" };
          }
          if (repairedAny) {
            // Tests were rewritten — restart iteration with the fixed
            // tests in place; do NOT increment attempt against the user
            // because the failure was the planner's bug, not the coder's.
            logger.info(`HU ${story.id}: Repairer fixed test(s); restarting acceptance gate without consuming iteration`);
            attempt -= 1;
            continue;
          }

          // No repair happened — normal coder feedback path.
          const diagnostic = buildDiagnosticPrompt(failed);
          logger.warn(`HU ${story.id}: ${failed.length} acceptance test(s) FAILED — sending diagnostic to coder`);
          setReviewerFeedback(laneSession, diagnostic);
          lanePlannedTask = `${huTask}\n\n--- ACCEPTANCE TEST FAILURES ---\n${diagnostic}`;
        }

        // All iterations exhausted
        logger.warn(`HU ${story.id}: max iterations reached with acceptance tests still failing`);
        return { approved: false, sessionId: laneSession.id, reason: "acceptance_tests_failed" };
      }

      // Fallback: no acceptance_tests → standard pipeline (reviewer/tester).
      // The loop reads everything through ctx.* — handing it a lane view
      // keeps the shared ctx untouched (no more mutate-and-restore dance).
      const laneCtx = { ...ctx, config: laneConfig, pipelineFlags: laneFlags, session: laneSession, brainCtx: laneBrain, plannedTask: lanePlannedTask };
      const result = await runIterationLoop(laneCtx, { task: huTask, askQuestion, emitter, logger });
      if (result?.approved) {
        await finalizeHuCommit({ story, branchName, config: laneConfig, logger, cwd: worktreePath });
      }
      return result;
    },
    emitter,
    eventBase: ctx.eventBase,
    logger,
    config: ctx.config,
    // PR1 (live HU status): forward the per-HU status updater so
    // hu-sub-pipeline can patch the plan JSON on every transition,
    // not only at the end of the run. The board's chokidar then
    // fires per-HU and the Kanban columns update in real time.
    onStatusChange: ctx.session?._liveStatusUpdater || null,
    // PR3 (per-HU outcome): same pattern, but for the rich
    // outcome blob written ONCE per HU at the end of runSingleHu.
    onOutcome: ctx.session?._liveOutcomeUpdater || null,
    // Cost D (KJC-TSK-0515): the sub-pipeline slices BudgetTracker
    // entries per HU and stamps `outcome.cost_usd` so the board can
    // show per-HU spend. Without this the tracker is invisible to it.
    budgetTracker: ctx.budgetTracker || null
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
  return { handled: true, result: finalResult };
}
