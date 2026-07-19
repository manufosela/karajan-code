/**
 * Coder stage logic.
 * Extracted from iteration-stages.js for maintainability.
 */

import { createAgent } from "../../agents/index.js";
import { CoderRole } from "../../roles/coder-role.js";
import { RefactorerRole } from "../../roles/refactorer-role.js";
import { addCheckpoint, markSessionStatus, saveSession } from "../../session/store.js";
import {
  setReviewerFeedback, setCoderTranscript, incrementRetryCount, resetRetryCount,
} from "../../session/mutators.js";
import { generateDiff, getUntrackedFiles } from "../../review/diff-generator.js";
import { evaluateTddPolicy } from "../../review/tdd-policy.js";
import { buildDeferredContext } from "../../review/scope-filter.js";
import { emitProgress, makeEvent, emitAgentOutput } from "../../utils/events.js";
import { runCoderWithFallback } from "../agent-fallback.js";
import { invokeSolomon } from "../solomon-escalation.js";
import { detectRateLimit } from "../../utils/rate-limit-detector.js";
import { createStallDetector } from "../../utils/stall-detector.js";
import { buildStandbyState } from "../../brain/standby-store.js";
import { applyQuotaSimulation } from "../../utils/quota-simulator.js";
import { snapshotHomeTopLevel, detectNewHomeEntries, formatLeakMessage, verifyLeaksAgainstTranscript, detectTranscriptCdLeaks } from "../fs-leak-detector.js";

export async function runCoderStage({ coderRoleInstance, coderRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration, brainCtx, acceptanceTests = null, adrs = null, specSection = null, reviewerFindings = null, huId = null }) {
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

  const coderOnOutput = (payload) => emitAgentOutput(emitter, eventBase, "coder", coderRole.provider, payload);
  const coderStall = createStallDetector({
    onOutput: coderOnOutput, emitter, eventBase, stage: "coder", provider: coderRole.provider
  });
  const coderStart = Date.now();
  // KJC-BUG-0032 (PR-I): snapshot $HOME's top-level entries BEFORE
  // the coder runs so we can detect leaks afterwards. The bug: a HU
  // titled "Initialize project skeleton: create assistant/…" had
  // Claude run `cd /home/manu/assistant && pnpm init …` and 36 MB
  // of code landed outside projectDir, outside any git repo.
  const homeSnapshotBeforeCoder = snapshotHomeTopLevel();
  let coderExecResult;
  try {
    coderExecResult = await coderRoleInstance.execute({
      task: plannedTask,
      reviewerFeedback,
      sonarSummary: session.last_sonar_summary,
      deferredContext: buildDeferredContext(session.deferred_issues),
      // Tests-first contract flows through to buildCoderPrompt which
      // renders the "Acceptance Tests — MUST pass" section.
      acceptanceTests,
      // PR F (v2.7.5): plan-aware context. ADRs apply to every HU on
      // the plan, the rest are scoped to this HU. All four pass through
      // untouched when the caller omits them (legacy single-task runs).
      adrs, specSection, reviewerFindings, huId,
      // PAR-E2 (KJC-TSK-0629): the stage's config wins over the role's own —
      // worktree lanes pass a laneConfig whose projectDir is the worktree.
      projectDir: config?.projectDir || null,
      // PAR-H (KJC-TSK-0631): lane env (KJ_LANE_SLOT / KJ_PORT_OFFSET)
      // reaches the coder subprocess so services it starts don't collide.
      env: config?.lane_env || null,
      onOutput: coderStall.onOutput,
      // Lets Brain Recovery persist a standby snapshot if the coder's
      // provider hits a quota cap mid-run (KJC hibernation wiring).
      sessionState: buildStandbyState({ session, config, huId }),
    });
  } finally {
    coderStall.stop();
  }
  trackBudget({ role: "coder", provider: coderRole.provider, model: coderRole.model, result: coderExecResult.result, duration_ms: Date.now() - coderStart });
  applyQuotaSimulation(coderExecResult, { iteration, agent: coderRole.provider });

  if (!coderExecResult.ok) {
    const details = coderExecResult.result?.error || coderExecResult.summary || "unknown error";
    // Quota cap → Brain Recovery already hibernated the run and persisted
    // the standby snapshot. Stop the stage cleanly: no fallback, no
    // Solomon. The caller turns this into a clean run halt; the HU is NOT
    // marked failed — it resumes via `kj standby resume`.
    if (coderExecResult.result?.action === "hibernate") {
      emitProgress(emitter, makeEvent("coder:hibernate", { ...eventBase, stage: "coder" }, {
        message: "Coder hibernated — provider quota exhausted, run can be resumed",
        detail: { standbyFile: coderExecResult.result?.standbyFile || null }
      }));
      return {
        action: "hibernate",
        standbyFile: coderExecResult.result?.standbyFile || null,
        recovery: coderExecResult.result?.recovery || null,
      };
    }
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

  // KJC-BUG-0032 (PR-I): scan $HOME for new top-level entries the
  // coder created OUTSIDE projectDir. Stop the HU loudly with a
  // plain-Spanish message instead of letting the user discover by
  // accident hours later that 36 MB of code is in the wrong place.
  // Runs BEFORE the success-path verification so a leaked HU doesn't
  // get marked as "Coder applied changes".
  const projectDirAbs = config.projectDir || process.cwd();
  const candidateLeaks = detectNewHomeEntries(homeSnapshotBeforeCoder, projectDirAbs);
  // Issue #546: snapshot-diff alone produces false positives when other
  // processes write to $HOME during the iteration window. Filter the
  // detected entries against the coder's transcript: only flag those
  // the coder demonstrably referenced.
  const coderTranscript = coderExecResult.result?.output || "";
  const layer1Leaks = verifyLeaksAgainstTranscript(candidateLeaks, coderTranscript);
  if (candidateLeaks.length > 0 && layer1Leaks.length === 0) {
    logger.warn(`fs-leak-detector: ${candidateLeaks.length} new $HOME entr(y/ies) detected but none referenced in the coder transcript — likely a concurrent host-side write, not flagging (#546).`);
  }
  // Layer 2 (BUG-0032): scan the transcript for `cd <abs-out-of-project> && <write-cmd>`
  // patterns the snapshot-diff misses (e.g. when target dir pre-existed).
  const layer2Leaks = detectTranscriptCdLeaks(coderTranscript, projectDirAbs);
  const fsLeaks = Array.from(new Set([...layer1Leaks, ...layer2Leaks]));
  if (fsLeaks.length > 0) {
    const msg = formatLeakMessage(fsLeaks, projectDirAbs);
    logger.error(msg);
    emitProgress(
      emitter,
      makeEvent("coder:fs-leak", { ...eventBase, stage: "coder" }, {
        status: "fail",
        message: `Coder escribió fuera del projectDir: ${fsLeaks.length} ruta(s) detectada(s)`,
        detail: { provider: coderRole.provider, leaks: fsLeaks, projectDir: projectDirAbs }
      })
    );
    await markSessionStatus(session, "failed");
    throw new Error(msg);
  }

  // Measure files changed so stale detection (solomon-rules) has accurate data
  let filesChanged = 0;
  try {
    const { verifyCoderOutput } = await import("../verification-gate.js");
    const verif = verifyCoderOutput({
      baseRef: session.session_start_sha,
      projectDir: config.projectDir || process.cwd()
    });
    if (verif.gitError) {
      // Git failed (bad baseRef, corrupt repo, git missing). Don't
      // feed filesChanged=0 into stale detection — it would blame the
      // coder for an infrastructure problem.
      logger?.warn?.(`[verification-gate] Git failed, change count is unreliable: ${verif.gitError}`);
    } else {
      filesChanged = verif.filesChanged || 0;
    }
  } catch (err) {
    logger?.warn?.(`[verification-gate] Skipped: ${err?.message || err}`);
  }

  // KJC-TSK-0375 PR3: stash the coder's raw transcript on the session so
  // the optional tool-judge stage can extract structured tool calls later
  // without re-invoking the coder. Cleared between iterations by the coder
  // overwriting it; ignored when the tool-judge flag is off.
  setCoderTranscript(session, coderTranscript);

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
  const refactorerOnOutput = (payload) => emitAgentOutput(emitter, eventBase, "refactorer", refactorerRole.provider, payload);
  const refactorerStall = createStallDetector({
    onOutput: refactorerOnOutput, emitter, eventBase, stage: "refactorer", provider: refactorerRole.provider
  });

  const refRole = new RefactorerRole({ config, logger, emitter, createAgentFn: createAgent });
  await refRole.init();
  const refactorerStart = Date.now();
  let refResult;
  try {
    refResult = await refRole.execute({
      task: plannedTask, onOutput: refactorerStall.onOutput,
      sessionState: buildStandbyState({ session, config }),
    });
  } finally {
    refactorerStall.stop();
  }
  trackBudget({ role: "refactorer", provider: refactorerRole.provider, model: refactorerRole.model, result: refResult.result, duration_ms: Date.now() - refactorerStart });
  applyQuotaSimulation(refResult, { iteration, agent: refactorerRole.provider });
  if (!refResult.ok) {
    const details = refResult.result?.error || refResult.summary || "unknown error";
    // Quota cap → hibernate cleanly, same as the coder stage above.
    if (refResult.result?.action === "hibernate") {
      emitProgress(emitter, makeEvent("refactorer:hibernate", { ...eventBase, stage: "refactorer" }, {
        message: "Refactorer hibernated — provider quota exhausted, run can be resumed",
        detail: { standbyFile: refResult.result?.standbyFile || null }
      }));
      return {
        action: "hibernate",
        standbyFile: refResult.result?.standbyFile || null,
        recovery: refResult.result?.recovery || null,
      };
    }
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

async function handleSolomonContinue(solomonResult, session, counterField, brainCtx) {
  if (solomonResult.action !== "continue") return false;
  if (solomonResult.humanGuidance) {
    setReviewerFeedback(session, `${session.last_reviewer_feedback ?? ""}\nUser guidance: ${solomonResult.humanGuidance}`);
    // Brain: also push user guidance into feedback queue when enabled
    if (brainCtx?.enabled) {
      const { processRoleOutput } = await import("../brain-coordinator.js");
      processRoleOutput(brainCtx, { roleName: "solomon", output: { verdict: "continue", summary: solomonResult.humanGuidance }, iteration: 0 });
    }
  }
  session[counterField] = 0;
  await saveSession(session);
  return true;
}

async function handleTddFailure({ tddEval, config, logger, emitter, eventBase, session, iteration, askQuestion, task, brainCtx }) {
  setReviewerFeedback(session, tddEval.message);
  // Brain: push TDD failure into feedback queue when enabled
  if (brainCtx?.enabled) {
    const { processRoleOutput } = await import("../brain-coordinator.js");
    processRoleOutput(brainCtx, { roleName: "tdd", output: { verdict: "fail", summary: tddEval.message }, iteration });
  }
  incrementRetryCount(session, "repeated_issue");
  await saveSession(session);

  if (session.repeated_issue_count < config.session.fail_fast_repeats) {
    return { action: "continue" };
  }

  // Brain: at the sub-loop limit the TDD gate must stop eating iterations.
  // KJC-BUG-0115: returning "continue" here short-circuited runSingleIteration
  // before the reviewer gate — 5/5 iterations ended without any review. The
  // failure is already queued as feedback; "proceed" lets the reviewer run.
  if (brainCtx?.enabled) {
    logger.info("Brain: TDD sub-loop limit reached — proceeding to reviewer with TDD failure as pending feedback");
    emitProgress(emitter, makeEvent("brain:tdd-retry-limit", { ...eventBase, stage: "tdd" }, {
      message: `TDD sub-loop limit reached (${session.repeated_issue_count}/${config.session.fail_fast_repeats}) — proceeding to reviewer`,
      detail: { subloop: "tdd", retryCount: session.repeated_issue_count, reason: tddEval.reason }
    }));
    resetRetryCount(session, "repeated_issue");
    await saveSession(session);
    return { action: "proceed" };
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
      task: task || session.task,
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
  const continued = await handleSolomonContinue(solomonResult, session, "repeated_issue_count", brainCtx);
  if (continued) return { action: "continue" };

  return { action: "continue" };
}

export async function runTddCheckStage({ config, logger, emitter, eventBase, session, trackBudget: _trackBudget, iteration, askQuestion, task, brainCtx }) {
  logger.setContext({ iteration, stage: "tdd" });
  let tddDiff, untrackedFiles;
  try {
    // PAR-E2 (KJC-TSK-0629): diff where the coder actually worked — a
    // worktree lane's changes are invisible from the main tree.
    tddDiff = await generateDiff({ baseRef: session.session_start_sha, projectDir: config?.projectDir || null });
    untrackedFiles = await getUntrackedFiles(config?.projectDir || null);
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
    return handleTddFailure({ tddEval, config, logger, emitter, eventBase, session, iteration, askQuestion, task, brainCtx });
  }

  return { action: "ok", sourceFiles: tddEval.sourceFiles, testFiles: tddEval.testFiles };
}
