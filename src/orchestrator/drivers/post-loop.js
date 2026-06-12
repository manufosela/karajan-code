/**
 * Post-loop driver — extracted from src/orchestrator/flow-runner.js in
 * TSK-0335 (Oleada 3 of the v2.7.4 audit refactor).
 *
 * Handlers for everything that happens AFTER the iteration loop decides
 * an outcome (approved, max-iterations, or simple finalization):
 *
 *   - handlePostLoopStages:        run tester → security → final audit
 *                                  after the reviewer has approved; any of
 *                                  them can demand one more coder pass.
 *   - finalizeApprovedSession:     commit/push/PR + PG card transition +
 *                                  full session journal + session:end event.
 *   - handleMaxIterationsReached:  Brain-owned decision at the iteration
 *                                  cap (extend vs finalize vs escalate).
 *                                  Legacy path delegates to Solomon.
 *   - tryAutoStartBoard:           auto-launch HU Board when config opts in.
 *   - writeHistoryRecord:          non-blocking HU history write on session end.
 *
 * Extracted verbatim; no behavior change. flow-runner.js now imports these
 * instead of defining them. Part of breaking up the 2254-LOC god-module —
 * see docs/ARCHITECTURE.md and the TSK-0335 acceptance criteria.
 */

import { generateDiff } from "../../review/diff-generator.js";
import { finalizeGitAutomation } from "../../git/automation.js";
import { listCommitsBetween, listFilesChangedSince } from "../../utils/git.js";
import { loadPlan, projectSlug as slugFor } from "../../plan/plan-store.js";
import { computePlanAdherenceScore } from "../../audit/plan-adherence.js";
import { saveSession, markSessionStatus } from "../../session/store.js";
import {
  setReviewerFeedback, setBudget, setRtkSavings, resetRetryCount,
} from "../../session/mutators.js";
import { emitProgress, makeEvent } from "../../utils/events.js";
import { runTesterStage, runSecurityStage, runFinalAuditStage } from "../post-loop-stages.js";
import { invokeSolomon } from "../solomon-escalation.js";
import { tryCiComment } from "../ci-integration.js";
import { getIntegration } from "../integrations.js";

export async function handlePostLoopStages({ config, session, emitter, eventBase, coderRole, trackBudget, i, task, stageResults, ciEnabled: _ciEnabled, testerEnabled, securityEnabled, askQuestion, logger, brainCtx }) {
  const postLoopDiff = await generateDiff({ baseRef: session.session_start_sha });

  if (testerEnabled) {
    const testerResult = await runTesterStage({
      config, logger, emitter, eventBase, session, coderRole, trackBudget,
      iteration: i, task, diff: postLoopDiff, askQuestion
    });
    if (testerResult.action === "pause") return { action: "return", result: testerResult.result };
    if (testerResult.action === "continue") {
      const summary = testerResult.stageResult?.summary || "Tester found issues";
      setReviewerFeedback(session, `Tester FAILED — fix these issues:\n${summary}`);
      await saveSession(session);
      if (testerResult.stageResult) stageResults.tester = testerResult.stageResult;
      // Brain: push tester failure into feedback queue + compress for next coder iteration
      if (brainCtx?.enabled) {
        const { processRoleOutput } = await import("../brain-coordinator.js");
        processRoleOutput(brainCtx, { roleName: "tester", output: testerResult.stageResult, iteration: i });
      }
      return { action: "continue" };
    }
    if (testerResult.stageResult) {
      stageResults.tester = testerResult.stageResult;
      await tryCiComment({ config, session, logger, agent: "Tester", body: `Tests: ${testerResult.stageResult.summary || "completed"}` });
    }
  }

  if (securityEnabled) {
    const securityResult = await runSecurityStage({
      config, logger, emitter, eventBase, session, coderRole, trackBudget,
      iteration: i, task, diff: postLoopDiff, askQuestion, brainCtx
    });
    if (securityResult.action === "pause") return { action: "return", result: securityResult.result };
    if (securityResult.action === "continue") {
      const summary = securityResult.stageResult?.summary || "Security found issues";
      setReviewerFeedback(session, `Security FAILED — fix these issues:\n${summary}`);
      await saveSession(session);
      if (securityResult.stageResult) stageResults.security = securityResult.stageResult;
      // Brain: push security findings into feedback queue + compress for next coder iteration
      if (brainCtx?.enabled) {
        const { processRoleOutput } = await import("../brain-coordinator.js");
        processRoleOutput(brainCtx, { roleName: "security", output: securityResult.stageResult, iteration: i });
      }
      return { action: "continue" };
    }
    if (securityResult.stageResult) {
      stageResults.security = securityResult.stageResult;
      await tryCiComment({ config, session, logger, agent: "Security", body: `Security scan: ${securityResult.stageResult.summary || "completed"}` });
    }
  }

  // Final audit — last quality gate before declaring success
  const auditResult = await runFinalAuditStage({
    config, logger, emitter, eventBase, session, coderRole, trackBudget,
    iteration: i, task, diff: postLoopDiff
  });
  if (auditResult.stageResult) {
    stageResults.audit = auditResult.stageResult;
    await tryCiComment({ config, session, logger, agent: "Audit", body: `Final audit: ${auditResult.stageResult.summary || "completed"}` });
  }
  if (auditResult.action === "retry") {
    // Audit found actionable issues — loop back to coder
    setReviewerFeedback(session, auditResult.feedback);
    await saveSession(session);
    return { action: "continue" };
  }

  return { action: "proceed" };
}

export async function finalizeApprovedSession({ config, gitCtx, task, logger, session, stageResults, emitter, eventBase, budgetSummary, pgCard, pgProject, review, i, rtkTracker }) {
  const gitResult = await finalizeGitAutomation({ config, gitCtx, task, logger, session, stageResults });

  // Accumulate final commits for PG card lifecycle tracking
  if (gitResult?.commits?.length) {
    const tracker = getIntegration("tracker");
    for (const c of gitResult.commits) tracker?.onCommit?.(session, c);
  }

  if (stageResults.planner?.ok) {
    stageResults.planner.completedSteps = [...(stageResults.planner.steps ?? [])];
  }
  setBudget(session, budgetSummary());
  await markSessionStatus(session, "approved");

  await getIntegration("tracker")?.onSessionApproved?.({ pgCard, pgProject, config, session, gitResult, logger });

  const deferredIssues = session.deferred_issues || [];
  const rtkSavings = rtkTracker?.hasData() ? rtkTracker.summary() : undefined;
  if (rtkSavings) setRtkSavings(session, rtkSavings);
  await saveSession(session);

  // --- Journal: write final files (shared writer, KJC-BUG-0084) ---
  const journalDir = session._journalDir;
  if (journalDir) {
    // 2026-05-07 dogfooding: gitResult.commits only carries the post-loop
    // commit (scaffold). Compute the full range from session_start_sha so
    // every commit the run produced shows up in execution order.
    let allCommits;
    try { allCommits = (await listCommitsBetween(session.head_at_start || session.session_start_sha)) || []; }
    catch { allCommits = gitResult?.commits || []; }
    const summaryCommits = allCommits.length > 0 ? allCommits : (gitResult?.commits || []);

    // KJC-TSK-0376 — plan adherence metric (deepeval-inspired). When the
    // run executed against a known plan (`kj run --plan <id>`), score how
    // faithfully the coder followed it. Pure offline; safe-by-default
    // (try/catch swallows missing helper or unreadable plan).
    let planAdherence = null;
    try {
      const planId = session._planRef?.planId
        || stageResults?.huReviewer?.planId
        || null;
      if (planId) {
        const projectDir = config?.projectDir
          || session.config_snapshot?.projectDir
          || process.cwd();
        const plan = await loadPlan(projectDir, planId).catch(() => null);
        if (plan && Array.isArray(plan.hus) && plan.hus.length > 0) {
          const filesChanged = await listFilesChangedSince(
            session.head_at_start || session.session_start_sha,
          ).catch(() => []);
          planAdherence = computePlanAdherenceScore({
            commits: summaryCommits,
            plan,
            filesChanged,
          });
        }
      }
    } catch (err) {
      logger?.warn?.(`Plan adherence calculation skipped: ${err.message}`);
    }

    const { writeSessionJournal } = await import("../../session/journal/write-all.js");
    await writeSessionJournal({
      session, logger,
      result: "APPROVED",
      iterations: i,
      budget: budgetSummary(),
      stages: stageResults,
      commits: summaryCommits,
      planAdherence,
    });
  }

  // Mirror the same enriched commit list into the session:end event so the
  // terminal `🏁 Result` banner (printSessionGit) shows every commit the
  // run produced, not just the post-loop scaffold one. We compute again
  // (cheap: one git log call) rather than threading a variable through
  // because the journal block is wrapped in try/catch and may have set
  // `summaryCommits` to a fallback we don't want for the event detail.
  // try/catch tolerates both promise rejection and sync undefined returns
  // (see the journal block above for the detailed rationale).
  let eventCommits = null;
  try { eventCommits = await listCommitsBetween(session.head_at_start || session.session_start_sha); }
  catch { /* leave null — we'll use gitResult unchanged */ }
  const gitForEvent = (Array.isArray(eventCommits) && eventCommits.length > 0)
    ? { ...gitResult, commits: eventCommits }
    : gitResult;
  const endDetail = { approved: true, iterations: i, stages: stageResults, git: gitForEvent, budget: budgetSummary(), deferredIssues };
  if (rtkSavings) endDetail.rtk_savings = rtkSavings;
  emitProgress(
    emitter,
    makeEvent("session:end", { ...eventBase, stage: "done" }, {
      message: deferredIssues.length > 0
        ? `Session approved (${deferredIssues.length} deferred issue(s) tracked as tech debt)`
        : "Session approved",
      detail: endDetail
    })
  );
  const result = { approved: true, sessionId: session.id, review, git: gitResult, deferredIssues };
  if (rtkSavings) result.rtk_savings = rtkSavings;
  return result;
}

export async function handleMaxIterationsReached({ session, budgetSummary, emitter, eventBase, config, stageResults, logger, askQuestion, task, rtkTracker, brainCtx }) {
  const budget = budgetSummary();

  // Brain-owned decision: max_iterations is guidance, not a hard rule.
  // Brain evaluates the feedback queue state to decide extend / finalize / escalate.
  // Solomon is only consulted if Brain cannot decide on its own.
  if (brainCtx?.enabled) {
    const entries = brainCtx.feedbackQueue?.entries || [];
    const pending = entries.map(e => ({ source: e.source, category: e.category, severity: e.severity, description: e.description }));
    const hasSecurity = entries.some(e => e.category === "security" || e.source === "security");
    const hasCorrectness = entries.some(e => ["correctness", "tests"].includes(e.category));

    if (hasSecurity) {
      // Brain: security issues unresolved → cannot finalize, escalate
      logger.warn(`Brain: max_iterations reached with ${entries.filter(e => e.category === "security" || e.source === "security").length} unresolved security issue(s) — cannot finalize`);
      return { paused: true, sessionId: session.id, question: "Brain: unresolved security issues at max_iterations. Review manually or extend pipeline.", context: "brain_security_block", pending };
    }

    if (hasCorrectness) {
      // Brain: correctness/test issues pending. Cap at MAX_EXTENSIONS to avoid infinite extensions.
      const MAX_EXTENSIONS = 2;
      if (brainCtx.extensionCount >= MAX_EXTENSIONS) {
        logger.warn(`Brain: ${brainCtx.extensionCount} extensions exhausted with correctness issues still pending — escalating to human`);
        return { paused: true, sessionId: session.id, question: `Brain exhausted ${MAX_EXTENSIONS} extensions with correctness/tests still pending. Manual intervention needed.`, context: "brain_extension_cap", pending };
      }
      brainCtx.extensionCount += 1;
      logger.info(`Brain: max_iterations reached with ${entries.filter(e => ["correctness", "tests"].includes(e.category)).length} correctness issue(s) pending — extending iterations (extension ${brainCtx.extensionCount}/${MAX_EXTENSIONS})`);
      resetRetryCount(session, "reviewer");
      await saveSession(session);
      return { approved: false, sessionId: session.id, reason: "max_iterations_extended", extraIterations: Math.ceil(config.max_iterations / 2) };
    }

    if (entries.length === 0) {
      // Brain: no pending feedback → last reviewer approved, finalize
      logger.info("Brain: max_iterations reached with clean feedback queue — finalizing as approved");
      return { approved: true, sessionId: session.id, reason: "brain_approved" };
    }

    // hasStyleOnly: genuine dilemma → Brain consults Solomon
    logger.info(`Brain: max_iterations with ${entries.length} style-only issue(s) — consulting Solomon on dilemma`);
    const solomonResult = await invokeSolomon({
      config, logger, emitter, eventBase, stage: "max_iterations", askQuestion, session,
      iteration: config.max_iterations,
      conflict: {
        stage: "brain-max-iterations",
        task,
        iterationCount: config.max_iterations,
        maxIterations: config.max_iterations,
        budget_usd: budget?.total_cost_usd || 0,
        dilemma: `Max iterations reached with ${entries.length} style-only issue(s) pending. Accept as-is or request more work?`,
        pendingIssues: pending,
        history: [{ agent: "pipeline", feedback: session.last_reviewer_feedback || "Max iterations reached" }]
      }
    });
    // Brain applies Solomon's decision
    if (solomonResult.action === "approve") {
      logger.info("Brain: Solomon advised approve for style-only pending — finalizing");
      return { approved: true, sessionId: session.id, reason: "brain_solomon_approved" };
    }
    if (solomonResult.action === "continue") {
      return { approved: false, sessionId: session.id, reason: "max_iterations_extended", extraIterations: solomonResult.extraIterations || Math.ceil(config.max_iterations / 2) };
    }
    if (solomonResult.action === "pause") {
      return { paused: true, sessionId: session.id, question: solomonResult.question, context: "brain_solomon_dilemma" };
    }
    // Fallback: escalate to human
    return { paused: true, sessionId: session.id, question: `Brain+Solomon cannot resolve: ${entries.length} pending issue(s) at max_iterations`, context: "max_iterations" };
  }

  // Legacy path (Brain disabled): original Solomon-driven flow
  const solomonResult = await invokeSolomon({
    config, logger, emitter, eventBase, stage: "max_iterations", askQuestion, session,
    iteration: config.max_iterations,
    conflict: {
      stage: "max_iterations",
      task,
      iterationCount: config.max_iterations,
      maxIterations: config.max_iterations,
      budget_usd: budget?.total_cost_usd || 0,
      history: [{ agent: "pipeline", feedback: session.last_reviewer_feedback || "Max iterations reached without reviewer approval" }]
    }
  });

  if (solomonResult.action === "approve") {
    logger.info("Solomon approved coder's work at max_iterations checkpoint");
    return { approved: true, sessionId: session.id, reason: "solomon_approved" };
  }

  if (solomonResult.action === "continue") {
    if (solomonResult.humanGuidance) {
      setReviewerFeedback(session, `Solomon guidance: ${solomonResult.humanGuidance}`);
    }
    resetRetryCount(session, "reviewer");
    await saveSession(session);
    const extraIterations = solomonResult.extraIterations || config.max_iterations;
    return { approved: false, sessionId: session.id, reason: "max_iterations_extended", humanGuidance: solomonResult.humanGuidance, extraIterations };
  }

  if (solomonResult.action === "pause") {
    return { paused: true, sessionId: session.id, question: solomonResult.question, context: "max_iterations" };
  }

  if (solomonResult.action === "subtask") {
    return { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "max_iterations_subtask" };
  }

  // Solomon couldn't resolve — fail
  setBudget(session, budgetSummary());
  const rtkSavings = rtkTracker?.hasData() ? rtkTracker.summary() : undefined;
  if (rtkSavings) setRtkSavings(session, rtkSavings);
  await markSessionStatus(session, "failed");
  const failDetail = { approved: false, reason: "max_iterations", iterations: config.max_iterations, stages: stageResults, budget: budgetSummary() };
  if (rtkSavings) failDetail.rtk_savings = rtkSavings;
  emitProgress(
    emitter,
    makeEvent("session:end", { ...eventBase, stage: "done" }, {
      status: "fail",
      message: "Max iterations reached (Solomon could not resolve)",
      detail: failDetail
    })
  );
  return { approved: false, sessionId: session.id, reason: "max_iterations" };
}

export async function tryAutoStartBoard(config, logger, emitter, eventBase) {
  // TSK-0273: gate on hu_board.auto_start alone. The previous double-gate
  // (enabled && auto_start) was confusing because `enabled` was never the
  // user-facing switch — only auto_start was. This matches the AC: "kj run
  // auto-inicia el board server si hu_board.auto_start es true".
  if (!config.hu_board?.auto_start) return;
  // Never auto-start during vitest: races the PID file and starts a detached
  // process that outlives the test run.
  if (process.env.VITEST || process.env.NODE_ENV === "test") return;

  try {
    const { startBoard, renderBoardBanner } = await import("../../commands/board.js");
    const boardPort = config.hu_board.port || 4000;
    // Scope the board URL to the current run's project (`/p/<slug>`) so
    // the user lands on a filtered view, not the global dashboard.
    const slug = config.projectDir ? slugFor(config.projectDir) : null;
    const boardResult = await startBoard(boardPort, { projectSlug: slug });
    const status = boardResult.alreadyRunning ? "already running" : "started";
    // Highlighted URL box — visible regardless of log level (matches the
    // post-planner auto-HU banner so the user gets the same signal either
    // way the board got started).
    console.log(renderBoardBanner({ url: boardResult.url, status }));
    logger.info(`HU Board ${status} at ${boardResult.url}`);
    emitProgress(emitter, makeEvent("board:started", eventBase, {
      message: `HU Board running at ${boardResult.url}`,
      detail: { pid: boardResult.pid, port: boardPort, url: boardResult.url }
    }));
  } catch (err) {
    logger.warn(`HU Board auto-start failed (non-blocking): ${err.message}`);
  }
}

export async function writeHistoryRecord({ sessionId, task, result, logger }) {
  try {
    const { createHistoryRecord } = await import("../../hu/store.js");
    const approved = Boolean(result?.approved);
    const summary = result?.review?.summary || result?.reason || null;
    await createHistoryRecord(sessionId, {
      task,
      result: JSON.stringify(result),
      approved,
      summary
    });
  } catch (err) {
    logger.warn(`HU history record failed (non-blocking): ${err.message}`);
  }
}
