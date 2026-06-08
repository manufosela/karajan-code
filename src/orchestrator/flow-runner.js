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
import {
  resolvePipelineFlags, handleDryRun,
} from "./config-init.js";
import { resolveTestHarness } from "../config/test-harness.js";
import { cleanupAutoInstalledSkills } from "../skills/skill-detector.js";
import { withRunContext } from "../utils/run-context.js";
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
import { runHuBatch } from "./drivers/run-hu-batch.js";
// Analysis-only path (taskType=audit/doc/infra) skips coder iterations
// and runs security + audit directly. These three were called without
// imports until ESLint surfaced it — same class of latent bug as the
// `saveSession` ReferenceError that took the demo down on 2026-04-27.
import { generateDiff } from "../review/diff-generator.js";
import { runSecurityStage, runFinalAuditStage } from "./post-loop-stages.js";

// Public re-exports (loadProductContext, shouldAutoContinueCheckpoint,
// parseCheckpointAnswer) live in src/orchestrator.js (the barrel).


// PG card "In Progress" logic moved to src/planning-game/pipeline-adapter.js → initPgAdapter()


/**
 * Boundary guard: make sure the session's terminal status reflects what
 * actually happened, even if some inner exit path forgot to call
 * `markSessionStatus`. KJC-BUG-0037 (N1 dogfooding 2026-05-07): runs
 * that took the Brain "max_iterations approved" / "Solomon-after-error
 * approved" / "Brain solomon-approved" exits returned `{approved:true}`
 * upstream but left `session.status = "running"` on disk indefinitely.
 * `kj status` then showed "Pipeline RUNNING" forever and the HU Board
 * carried a perma-zombie.
 *
 * Maps the result shape to a terminal status:
 *   approved → "approved"
 *   paused   → "paused"
 *   cancelled → "cancelled"
 *   hibernated → "hibernated"
 *   anything else → "failed"
 *
 * Idempotent: only writes when the current status is still "running"
 * (or unset). If an inner path already sealed it correctly, this is a
 * no-op.
 *
 * Safe-by-default: never throws. A failure here must not block the
 * top-level result from being returned to the caller.
 *
 * @param {object} session
 * @param {object} [result]
 */
export async function sealSessionStatusIfStillRunning(session, result) {
  try {
    if (!session) return;
    const current = session.status;
    if (current && current !== "running") return;
    let target = "failed";
    if (result?.approved === true) target = "approved";
    else if (result?.paused === true) target = "paused";
    else if (result?.cancelled === true) target = "cancelled";
    // A run hibernated on a provider quota cap is NOT a failure — it is
    // suspended and resumable via `kj standby resume`. Sealing it as
    // `failed` would let the HU-zombie reaper treat it as dead work.
    else if (result?.hibernated === true) target = "hibernated";
    await markSessionStatus(session, target);
  } catch { /* non-blocking */ }
}

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

    // --- HU Sub-Pipeline: extracted to drivers/run-hu-batch.js (PR-L) ---
    // 244 LOC of needsSubPipeline check + per-HU iteration with
    // policies + acceptance-tests gate + Sonar + tester translation.
    const huBatch = await runHuBatch({ ctx, task, askQuestion, emitter, logger });
    if (huBatch.handled) {
      await sealSessionStatusIfStillRunning(ctx.session, huBatch.result);
      return huBatch.result;
    }

    // --- Standard single-task pipeline (1 HU or no HU reviewer) ---
    const result = await runIterationLoop(ctx, { task: ctx.plannedTask, askQuestion, emitter, logger });
    await writeHistoryRecord({ sessionId: ctx.session.id, task, result, logger });
    await sealSessionStatusIfStillRunning(ctx.session, result);
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
      const { sendTelemetryEvent, computeCachedPct } = await import("../utils/telemetry.js");
      const durationS = Math.round((Date.now() - ctx.startedAt) / 1000);
      const sessionStatus = ctx.session?.status || "unknown";
      // Φ0-H (KJC-TSK-0526): aggregate cache-hit ratios per role so we
      // can see on the fleet how much each provider's cache is buying.
      let cachedPct = { cached_pct_coder: null, cached_pct_reviewer: null, cached_pct_total: null };
      try {
        const budgetSummary = ctx.budgetTracker?.summary?.();
        if (budgetSummary) cachedPct = computeCachedPct(budgetSummary);
      } catch { /* non-blocking — telemetry must never break runs */ }
      sendTelemetryEvent("pipeline_complete", {
        mode: config.review_mode,
        agent: ctx.coderRole?.provider || config.coder,
        duration_s: durationS,
        success: sessionStatus === "approved",
        taskType: ctx.session?.resolved_policies?.taskType || null,
        ...cachedPct
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
