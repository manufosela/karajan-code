/**
 * Init-context driver — extracted from src/orchestrator/flow-runner.js in
 * TSK-0335 (Oleada 3 of the v2.7.4 audit refactor).
 *
 * Builds the PipelineContext for runFlow: loads config, resolves roles,
 * wires budget tracker, attaches RTK wrappers, starts the HU Board,
 * loads product context, creates the session, runs the pre-loop stages,
 * and sets up the session journal + git automation.
 *
 * Extracted verbatim; no behavior change. Split from pre-loop.js because
 * together they would exceed the 600-LOC/driver ceiling set by the
 * TSK-0335 acceptance criteria.
 */

import { createAgent } from "../../agents/index.js";
import { resolveRole } from "../../config.js";
import { resolveReviewProfile } from "../../review/profiles.js";
import { RepeatDetector, getRepeatThreshold } from "../../repeat-detector.js";
import { emitProgress, makeEvent } from "../../utils/events.js";
import { prepareGitAutomation } from "../../git/automation.js";
import { CoderRole } from "../../roles/coder-role.js";
import { PipelineContext } from "../pipeline-context.js";
import { detectRtk } from "../../utils/rtk-detect.js";
import { createRtkRunner, RtkSavingsTracker } from "../../utils/rtk-wrapper.js";
import { setRunner as setDiffRunner, setProjectDir as setDiffProjectDir } from "../../review/diff-generator.js";
import { setRunner as setGitRunner } from "../../utils/git.js";
import {
  loadProductContext, resolvePipelineFlags, createBudgetManager,
  initializeSession, autoInit,
} from "../config-init.js";
import {
  createJournalDir, writePreLoopJournal, buildPlanSummary,
} from "../session-journal.js";
import { setPgCard, setJournalContext } from "../../session/mutators.js";
import { getRunContext } from "../../utils/run-context.js";
import { getIntegration } from "../integrations.js";
import { tryAutoStartBoard } from "./post-loop.js";
import { runPreLoopStages } from "./pre-loop.js";

export async function initFlowContext({ task, config, logger, emitter, askQuestion, pgTaskId, pgProject, flags }) {
  // Auto-init .karajan/ if missing (copies coder-rules, review-rules, role templates)
  const initProjectDir = config.projectDir || process.cwd();
  await autoInit(initProjectDir, logger);

  // Smart role assignment: detect installed AIs and assign to roles
  // Only runs if: (a) no roles configured AND (b) not in test environment
  const needsAssignment = !config.roles?.coder?.provider && !config.coder && process.env.NODE_ENV !== "test" && !process.env.VITEST;
  if (needsAssignment) {
    try {
      const { autoAssignRoles, applyRoleAssignments } = await import("../../utils/role-assigner.js");
      const { assignments } = await autoAssignRoles(logger);
      if (assignments) config = applyRoleAssignments({ ...config }, assignments);
    } catch { /* non-blocking — defaults will be used */ }
  }

  // Scope all git diffs to projectDir (prevents leaking unrelated branch changes)
  // When running from a subdirectory of a git repo, use relative path as scope
  let diffScope = config.projectDir || null;
  if (!diffScope) {
    try {
      // Audit follow-up: same execSync→execFileSync migration as #555.
      const { execFileSync } = await import("node:child_process");
      const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
      const cwd = process.cwd();
      if (cwd !== repoRoot && cwd.startsWith(repoRoot)) {
        diffScope = cwd.slice(repoRoot.length + 1);
        logger.info(`Running from subdirectory — diff scoped to ${diffScope}/`);
      }
    } catch { /* git not available */ }
  }
  // TSK-0338: write into the per-run AsyncLocalStorage context instead of
  // mutating module-level state. Falls back to setDiffProjectDir() when no
  // run context is active (legacy CLI callers, tests not going through
  // runFlow). The write-to-both keeps back-compat without trading isolation.
  const runCtx = getRunContext();
  if (runCtx) runCtx.projectDir = diffScope;
  else setDiffProjectDir(diffScope);

  // Auto-detect Chrome DevTools MCP
  const { detectDevToolsMcp } = await import("../../webperf/devtools-detect.js");
  const devToolsAvailable = await detectDevToolsMcp(logger);
  if (devToolsAvailable) {
    config = { ...config, webperf: { ...config.webperf, devtools_mcp: true } };
  }

  const ctx = new PipelineContext({ config, session: null, logger, emitter, task, flags });
  ctx.askQuestion = askQuestion;
  ctx.pgTaskId = pgTaskId;
  ctx.pgProject = pgProject;

  ctx.coderRole = resolveRole(config, "coder");
  ctx.reviewerRole = resolveRole(config, "reviewer");
  ctx.refactorerRole = resolveRole(config, "refactorer");
  ctx.pipelineFlags = resolvePipelineFlags(config);
  ctx.repeatDetector = new RepeatDetector({ threshold: getRepeatThreshold(config) });
  ctx.coderRoleInstance = new CoderRole({ config, logger, emitter, createAgentFn: createAgent, askHost: askQuestion });
  ctx.startedAt = Date.now();
  ctx.eventBase = { sessionId: null, iteration: 0, stage: null, startedAt: ctx.startedAt };
  const { budgetTracker, budgetLimit, budgetSummary, trackBudget } = createBudgetManager({
    config,
    emitter,
    eventBase: ctx.eventBase,
    // Provides fresh compression data for "With KJ vs Without KJ" comparison
    // (KJC-TSK-0274). Invoked on every budgetSummary() call.
    getCompressionStats: () => ({
      rtkSavings: ctx.rtkTracker?.hasData() ? ctx.rtkTracker.summary() : (ctx.session?.rtk_savings || null),
      brainCtx: ctx.brainCtx || null,
    }),
  });
  ctx.budgetTracker = budgetTracker;
  ctx.budgetLimit = budgetLimit;
  ctx.budgetSummary = budgetSummary;
  ctx.trackBudget = trackBudget;

  // --- RTK detection ---
  const rtkResult = await detectRtk();
  if (rtkResult.available) {
    config = { ...config, rtk: { available: true, version: rtkResult.version } };
    const rtkTracker = new RtkSavingsTracker();
    const rtkRunner = createRtkRunner(true, rtkTracker);
    // TSK-0338: install rtkRunner into the per-run context; module-level
    // setters are the back-compat path for runs outside a withRunContext scope.
    if (runCtx) runCtx.runner = rtkRunner;
    else {
      setDiffRunner(rtkRunner);
      setGitRunner(rtkRunner);
    }
    ctx.rtkTracker = rtkTracker;
    logger.info(`RTK detected (${rtkResult.version}) — wrapping internal git/diff commands with rtk`);
    emitProgress(emitter, makeEvent("rtk:detected", ctx.eventBase, {
      message: "RTK detected — internal commands wrapped for token optimization",
      detail: { version: rtkResult.version, executorType: "local" }
    }));
  }

  // --- HU Board auto-start ---
  await tryAutoStartBoard(config, logger, emitter, ctx.eventBase);

  // --- Product Context ---
  const ctxProjectDir = config.projectDir || process.cwd();
  const { content: productContext, source: productContextSource } = await loadProductContext(ctxProjectDir);
  if (productContext) {
    config = { ...config, productContext };
    logger.info(`Product context loaded from ${productContextSource}`);
    emitProgress(emitter, makeEvent("context:loaded", ctx.eventBase, {
      message: "Product context loaded",
      detail: { source: productContextSource }
    }));
  }

  ctx.session = await initializeSession({ task, config, flags, pgTaskId, pgProject });
  ctx.eventBase.sessionId = ctx.session.id;

  // Karajan Brain: initialize runtime context (opt-in via config.brain.enabled)
  const { createBrainContext, isBrainEnabled } = await import("../brain-coordinator.js");
  ctx.brainCtx = createBrainContext({ enabled: isBrainEnabled(config) });
  if (ctx.brainCtx.enabled) {
    logger.info("Karajan Brain enabled — feedback queue, verification, compression active");
  }

  const trackerResult = await getIntegration("tracker")?.onSessionStart?.({
    session: ctx.session, config, logger, pgTaskId, pgProject,
  });
  ctx.pgCard = trackerResult?.pgCard ?? null;
  setPgCard(ctx.session, ctx.pgCard || null);

  emitProgress(
    emitter,
    makeEvent("session:start", ctx.eventBase, {
      message: "Session started",
      detail: { task, coder: ctx.coderRole.provider, reviewer: ctx.reviewerRole.provider, maxIterations: config.max_iterations }
    })
  );

  // KJC-BUG-0058: on `kj resume`, rehydrate stage results from the loaded
  // session so completed pre-loop stages (researcher, architect, planner…)
  // are skipped instead of re-executed. `setStageResult` mirrors writes
  // into both `stage_results` (full payload) and `stages_completed` (flat
  // array) — copying `stage_results` here is sufficient because
  // `runPreLoopStages` only checks membership in `stageResults`.
  ctx.stageResults = { ...(ctx.session?.stage_results || {}) };
  ctx.sonarState = { issuesInitial: null, issuesFinal: null };

  const preLoopResult = await runPreLoopStages({ config, logger, emitter, eventBase: ctx.eventBase, session: ctx.session, flags, pipelineFlags: ctx.pipelineFlags, coderRole: ctx.coderRole, trackBudget: ctx.trackBudget, task, askQuestion, pgTaskId, pgProject, stageResults: ctx.stageResults, brainCtx: ctx.brainCtx });
  ctx.plannedTask = preLoopResult.plannedTask;
  ctx.config = preLoopResult.updatedConfig;

  // --- Session Journal: persist pre-loop outputs + display plan summary ---
  const reportDir = ctx.config.output?.report_dir || ".reviews";
  try {
    ctx.journalDir = await createJournalDir(reportDir, ctx.session.id);
    const journalFiles = await writePreLoopJournal(ctx.journalDir, ctx.stageResults);
    ctx.journalFiles = journalFiles;
    ctx.journalIterations = [];
    ctx.journalDecisions = [];

    // Attach journal state to session so finalizeApprovedSession can access it
    setJournalContext(ctx.session, {
      dir: ctx.journalDir,
      files: journalFiles,
      iterations: ctx.journalIterations,
      decisions: ctx.journalDecisions,
      startedAt: ctx.startedAt,
    });

    // Display plan summary in console before iteration loop
    const planSummary = buildPlanSummary({
      pipelineFlags: ctx.pipelineFlags,
      config: ctx.config,
      stageResults: ctx.stageResults,
      task
    });
    console.log(planSummary);
  } catch (err) {
    logger.warn(`Journal init failed (non-blocking): ${err.message}`);
    ctx.journalDir = null;
    ctx.journalFiles = [];
    ctx.journalIterations = [];
    ctx.journalDecisions = [];
  }

  ctx.gitCtx = await prepareGitAutomation({ config: ctx.config, task, logger, session: ctx.session });
  const projectDir = ctx.config.projectDir || process.cwd();
  ctx.reviewRules = (await resolveReviewProfile({ mode: ctx.config.review_mode, projectDir })).rules;
  await ctx.coderRoleInstance.init();

  return ctx;
}
