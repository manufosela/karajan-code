/**
 * Coder stage logic.
 * Extracted from iteration-stages.js for maintainability.
 */

import { createAgent } from "../../agents/index.js";
import { CoderRole } from "../../roles/coder-role.js";
import { RefactorerRole } from "../../roles/refactorer-role.js";
import { addCheckpoint, markSessionStatus, saveSession } from "../../session-store.js";
import { generateDiff, getUntrackedFiles } from "../../review/diff-generator.js";
import { evaluateTddPolicy } from "../../review/tdd-policy.js";
import { buildDeferredContext } from "../../review/scope-filter.js";
import { emitProgress, makeEvent } from "../../utils/events.js";
import { runCoderWithFallback } from "../agent-fallback.js";
import { invokeSolomon } from "../solomon-escalation.js";
import { detectRateLimit } from "../../utils/rate-limit-detector.js";
import { createStallDetector } from "../../utils/stall-detector.js";

export async function runCoderStage({ coderRoleInstance, coderRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration, brainCtx }) {
  logger.setContext({ iteration, stage: "coder" });
  emitProgress(
    emitter,
    makeEvent("coder:start", { ...eventBase, stage: "coder" }, {
      message: `Coder (${coderRole.provider}) running`,
      detail: { coder: coderRole.provider, provider: coderRole.provider, executorType: "agent" }
    })
  );

  // Brain: if enabled and queue has entries, use enriched feedback instead of flat string
  let reviewerFeedback = session.last_reviewer_feedback;
  if (brainCtx?.enabled) {
    const { buildCoderFeedbackPrompt } = await import("../brain-coordinator.js");
    const enriched = buildCoderFeedbackPrompt(brainCtx);
    if (enriched) {
      reviewerFeedback = enriched;
      logger.info(`Brain: using enriched feedback (${brainCtx.feedbackQueue.entries.length} entries)`);
    }
  }

  const coderOnOutput = ({ stream, line }) => {
    emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "coder" }, {
      message: line,
      detail: { stream, agent: coderRole.provider }
    }));
  };
  const coderStall = createStallDetector({
    onOutput: coderOnOutput, emitter, eventBase, stage: "coder", provider: coderRole.provider
  });
  const coderStart = Date.now();
  let coderExecResult;
  try {
    coderExecResult = await coderRoleInstance.execute({
      task: plannedTask,
      reviewerFeedback,
      sonarSummary: session.last_sonar_summary,
      deferredContext: buildDeferredContext(session.deferred_issues),
      onOutput: coderStall.onOutput
    });
  } finally {
    coderStall.stop();
  }
  trackBudget({ role: "coder", provider: coderRole.provider, model: coderRole.model, result: coderExecResult.result, duration_ms: Date.now() - coderStart });

  if (!coderExecResult.ok) {
    const details = coderExecResult.result?.error || coderExecResult.summary || "unknown error";
    const rateLimitCheck = detectRateLimit({
      stderr: coderExecResult.result?.error || "",
      stdout: coderExecResult.result?.output || ""
    });

    if (rateLimitCheck.isRateLimit) {
      // Try fallback agent if configured
      const fallbackCoder = config.coder_options?.fallback_coder;
      if (fallbackCoder && fallbackCoder !== coderRole.provider) {
        logger.warn(`Coder ${coderRole.provider} hit rate limit, falling back to ${fallbackCoder}`);
        emitProgress(
          emitter,
          makeEvent("coder:fallback", { ...eventBase, stage: "coder" }, {
            message: `Coder ${coderRole.provider} rate-limited, switching to ${fallbackCoder}`,
            detail: { primary: coderRole.provider, fallback: fallbackCoder }
          })
        );

        const fallbackResult = await runCoderWithFallback({
          coderName: fallbackCoder,
          fallbackCoder: null,
          config,
          logger,
          emitter,
          RoleClass: CoderRole,
          roleInput: { task: plannedTask, reviewerFeedback: session.last_reviewer_feedback, sonarSummary: session.last_sonar_summary, onOutput: coderOnOutput },
          session,
          iteration,
          onAttemptResult: ({ coder, result }) => {
            trackBudget({ role: "coder", provider: coder, model: coderRole.model, result, duration_ms: Date.now() - coderStart });
          }
        });

        if (fallbackResult.execResult?.ok) {
          await addCheckpoint(session, { stage: "coder", iteration, note: `Coder completed via fallback (${fallbackCoder})`, provider: fallbackCoder, model: null });
          emitProgress(
            emitter,
            makeEvent("coder:end", { ...eventBase, stage: "coder" }, {
              message: `Coder completed (fallback: ${fallbackCoder})`,
              detail: { provider: fallbackCoder, executorType: "agent" }
            })
          );
          return;
        }
      }

      // No fallback or fallback also failed — enter standby
      return {
        action: "standby",
        standbyInfo: {
          agent: coderRole.provider,
          cooldownMs: rateLimitCheck.cooldownMs || (rateLimitCheck.isProviderOutage ? 30000 : null),
          cooldownUntil: rateLimitCheck.cooldownUntil,
          message: rateLimitCheck.message,
          isProviderOutage: rateLimitCheck.isProviderOutage || false
        }
      };
    }

    await markSessionStatus(session, "failed");
    emitProgress(
      emitter,
      makeEvent("coder:end", { ...eventBase, stage: "coder" }, {
        status: "fail",
        message: `Coder failed: ${details}`,
        detail: { provider: coderRole.provider, executorType: "agent" }
      })
    );
    throw new Error(`Coder failed: ${details}`);
  }

  // Measure files changed so stale detection (solomon-rules) has accurate data
  let filesChanged = 0;
  try {
    const { verifyCoderOutput } = await import("../verification-gate.js");
    const verif = verifyCoderOutput({
      baseRef: session.session_start_sha,
      projectDir: config.projectDir || process.cwd()
    });
    filesChanged = verif.filesChanged || 0;
  } catch { /* ignore verification errors */ }

  await addCheckpoint(session, { stage: "coder", iteration, note: "Coder applied changes", provider: coderRole.provider, model: coderRole.model || null, filesChanged });
  emitProgress(
    emitter,
    makeEvent("coder:end", { ...eventBase, stage: "coder" }, {
      message: "Coder completed",
      detail: { provider: coderRole.provider, executorType: "agent", filesChanged }
    })
  );

  // Brain: verify coder produced real changes + clear feedback queue (now addressed)
  if (brainCtx?.enabled) {
    const { verifyCoderRan, clearFeedback } = await import("../brain-coordinator.js");
    const result = verifyCoderRan(brainCtx, {
      baseRef: session.session_start_sha,
      projectDir: config.projectDir || process.cwd()
    });
    const maxFailures = config.brain?.max_consecutive_verification_failures ?? 2;
    if (!result.passed) {
      logger.warn(`Brain verification: coder made 0 changes (consecutive failures: ${brainCtx.verificationTracker.consecutiveFailures}/${maxFailures})`);
      emitProgress(emitter, makeEvent("brain:verification", { ...eventBase, stage: "coder" }, {
        message: `Brain: coder produced no changes (${brainCtx.verificationTracker.consecutiveFailures}/${maxFailures} consecutive failures)`,
        detail: { filesChanged: result.filesChanged, consecutiveFailures: brainCtx.verificationTracker.consecutiveFailures }
      }));
      if (brainCtx.verificationTracker.consecutiveFailures >= maxFailures) {
        await markSessionStatus(session, "stalled");
        throw new Error(`Brain: ${maxFailures} consecutive coder iterations with 0 file changes — pipeline stalled`);
      }
    } else {
      clearFeedback(brainCtx);
    }
  }
}

export async function runRefactorerStage({ refactorerRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration }) {
  logger.setContext({ iteration, stage: "refactorer" });
  emitProgress(
    emitter,
    makeEvent("refactorer:start", { ...eventBase, stage: "refactorer" }, {
      message: `Refactorer (${refactorerRole.provider}) running`,
      detail: { refactorer: refactorerRole.provider, provider: refactorerRole.provider, executorType: "agent" }
    })
  );
  const refactorerOnOutput = ({ stream, line }) => {
    emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "refactorer" }, {
      message: line,
      detail: { stream, agent: refactorerRole.provider }
    }));
  };
  const refactorerStall = createStallDetector({
    onOutput: refactorerOnOutput, emitter, eventBase, stage: "refactorer", provider: refactorerRole.provider
  });

  const refRole = new RefactorerRole({ config, logger, emitter, createAgentFn: createAgent });
  await refRole.init();
  const refactorerStart = Date.now();
  let refResult;
  try {
    refResult = await refRole.execute({ task: plannedTask, onOutput: refactorerStall.onOutput });
  } finally {
    refactorerStall.stop();
  }
  trackBudget({ role: "refactorer", provider: refactorerRole.provider, model: refactorerRole.model, result: refResult.result, duration_ms: Date.now() - refactorerStart });
  if (!refResult.ok) {
    const details = refResult.result?.error || refResult.summary || "unknown error";
    const rateLimitCheck = detectRateLimit({
      stderr: refResult.result?.error || "",
      stdout: refResult.result?.output || ""
    });

    if (rateLimitCheck.isRateLimit) {
      // Enter standby instead of pausing
      return {
        action: "standby",
        standbyInfo: {
          agent: refactorerRole.provider,
          cooldownMs: rateLimitCheck.cooldownMs || (rateLimitCheck.isProviderOutage ? 30000 : null),
          cooldownUntil: rateLimitCheck.cooldownUntil,
          message: rateLimitCheck.message,
          isProviderOutage: rateLimitCheck.isProviderOutage || false
        }
      };
    }

    await markSessionStatus(session, "failed");
    emitProgress(
      emitter,
      makeEvent("refactorer:end", { ...eventBase, stage: "refactorer" }, {
        status: "fail",
        message: `Refactorer failed: ${details}`,
        detail: { provider: refactorerRole.provider, executorType: "agent" }
      })
    );
    throw new Error(`Refactorer failed: ${details}`);
  }
  await addCheckpoint(session, { stage: "refactorer", iteration, note: "Refactorer applied cleanups", provider: refactorerRole.provider, model: refactorerRole.model || null });
  emitProgress(
    emitter,
    makeEvent("refactorer:end", { ...eventBase, stage: "refactorer" }, {
      message: "Refactorer completed",
      detail: { provider: refactorerRole.provider, executorType: "agent" }
    })
  );
}

function handleSolomonAction(solomonResult, session, contextPrefix) {
  if (solomonResult.action === "pause") {
    return { action: "pause", result: { paused: true, sessionId: session.id, question: solomonResult.question, context: `${contextPrefix}_fail_fast` } };
  }
  if (solomonResult.action === "subtask") {
    return { action: "pause", result: { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: `${contextPrefix}_subtask` } };
  }
  return null;
}

async function handleSolomonContinue(solomonResult, session, counterField) {
  if (solomonResult.action !== "continue") return false;
  if (solomonResult.humanGuidance) {
    session.last_reviewer_feedback += `\nUser guidance: ${solomonResult.humanGuidance}`;
  }
  session[counterField] = 0;
  await saveSession(session);
  return true;
}

async function handleTddFailure({ tddEval, config, logger, emitter, eventBase, session, iteration, askQuestion }) {
  session.last_reviewer_feedback = tddEval.message;
  session.repeated_issue_count += 1;
  await saveSession(session);

  if (session.repeated_issue_count < config.session.fail_fast_repeats) {
    return { action: "continue" };
  }

  emitProgress(
    emitter,
    makeEvent("solomon:escalate", { ...eventBase, stage: "tdd" }, {
      message: `TDD sub-loop limit reached (${session.repeated_issue_count}/${config.session.fail_fast_repeats})`,
      detail: { subloop: "tdd", retryCount: session.repeated_issue_count, reason: tddEval.reason }
    })
  );

  const solomonResult = await invokeSolomon({
    config, logger, emitter, eventBase, stage: "tdd", askQuestion, session, iteration,
    conflict: {
      stage: "tdd",
      task: session.task,
      iterationCount: session.repeated_issue_count,
      maxIterations: config.session.fail_fast_repeats,
      reason: tddEval.reason,
      sourceFiles: tddEval.sourceFiles,
      testFiles: tddEval.testFiles,
      history: [{ agent: "tdd-policy", feedback: tddEval.message }]
    }
  });

  const actionResult = handleSolomonAction(solomonResult, session, "tdd");
  if (actionResult) return actionResult;
  const continued = await handleSolomonContinue(solomonResult, session, "repeated_issue_count");
  if (continued) return { action: "continue" };

  return { action: "continue" };
}

export async function runTddCheckStage({ config, logger, emitter, eventBase, session, trackBudget, iteration, askQuestion }) {
  logger.setContext({ iteration, stage: "tdd" });
  let tddDiff, untrackedFiles;
  try {
    tddDiff = await generateDiff({ baseRef: session.session_start_sha });
    untrackedFiles = await getUntrackedFiles();
  } catch (err) {
    logger.warn(`TDD diff generation failed: ${err.message}`);
    return { action: "continue", stageResult: { ok: false, summary: `TDD check failed: ${err.message}` } };
  }
  const effectiveTaskType = session.resolved_policies?.taskType || null;
  const tddEval = evaluateTddPolicy(tddDiff, config.development, untrackedFiles, effectiveTaskType);
  await addCheckpoint(session, {
    stage: "tdd-policy",
    iteration,
    ok: tddEval.ok,
    reason: tddEval.reason,
    source_files: tddEval.sourceFiles?.length || 0,
    test_files: tddEval.testFiles?.length || 0
  });

  emitProgress(
    emitter,
    makeEvent("tdd:result", { ...eventBase, stage: "tdd" }, {
      status: tddEval.ok ? "ok" : "fail",
      message: tddEval.ok ? "TDD policy passed" : `TDD policy failed: ${tddEval.reason}`,
      detail: {
        ok: tddEval.ok,
        reason: tddEval.reason,
        sourceFiles: tddEval.sourceFiles?.length || 0,
        testFiles: tddEval.testFiles?.length || 0,
        executorType: "local"
      }
    })
  );

  if (!tddEval.ok) {
    return handleTddFailure({ tddEval, config, logger, emitter, eventBase, session, iteration, askQuestion });
  }

  return { action: "ok" };
}
