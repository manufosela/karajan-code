import { createAgent } from "../agents/index.js";
import { CoderRole } from "../roles/coder-role.js";
import { RefactorerRole } from "../roles/refactorer-role.js";
import { SonarRole } from "../roles/sonar-role.js";
import { addCheckpoint, markSessionStatus, saveSession, pauseSession } from "../session-store.js";
import { generateDiff } from "../review/diff-generator.js";
import { evaluateTddPolicy } from "../review/tdd-policy.js";
import { validateReviewResult } from "../review/schema.js";
import { filterReviewScope, buildDeferredContext } from "../review/scope-filter.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { runReviewerWithFallback } from "./reviewer-fallback.js";
import { runCoderWithFallback } from "./agent-fallback.js";
import { invokeSolomon } from "./solomon-escalation.js";
import { detectRateLimit } from "../utils/rate-limit-detector.js";
import { createStallDetector } from "../utils/stall-detector.js";

export async function runCoderStage({ coderRoleInstance, coderRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration }) {
  logger.setContext({ iteration, stage: "coder" });
  emitProgress(
    emitter,
    makeEvent("coder:start", { ...eventBase, stage: "coder" }, {
      message: `Coder (${coderRole.provider}) running`,
      detail: { coder: coderRole.provider }
    })
  );

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
      reviewerFeedback: session.last_reviewer_feedback,
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
              message: `Coder completed (fallback: ${fallbackCoder})`
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
          cooldownMs: rateLimitCheck.cooldownMs,
          cooldownUntil: rateLimitCheck.cooldownUntil,
          message: rateLimitCheck.message
        }
      };
    }

    await markSessionStatus(session, "failed");
    emitProgress(
      emitter,
      makeEvent("coder:end", { ...eventBase, stage: "coder" }, {
        status: "fail",
        message: `Coder failed: ${details}`
      })
    );
    throw new Error(`Coder failed: ${details}`);
  }

  await addCheckpoint(session, { stage: "coder", iteration, note: "Coder applied changes", provider: coderRole.provider, model: coderRole.model || null });
  emitProgress(
    emitter,
    makeEvent("coder:end", { ...eventBase, stage: "coder" }, {
      message: "Coder completed"
    })
  );
}

export async function runRefactorerStage({ refactorerRole, config, logger, emitter, eventBase, session, plannedTask, trackBudget, iteration }) {
  logger.setContext({ iteration, stage: "refactorer" });
  emitProgress(
    emitter,
    makeEvent("refactorer:start", { ...eventBase, stage: "refactorer" }, {
      message: `Refactorer (${refactorerRole.provider}) running`,
      detail: { refactorer: refactorerRole.provider }
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
          cooldownMs: rateLimitCheck.cooldownMs,
          cooldownUntil: rateLimitCheck.cooldownUntil,
          message: rateLimitCheck.message
        }
      };
    }

    await markSessionStatus(session, "failed");
    emitProgress(
      emitter,
      makeEvent("refactorer:end", { ...eventBase, stage: "refactorer" }, {
        status: "fail",
        message: `Refactorer failed: ${details}`
      })
    );
    throw new Error(`Refactorer failed: ${details}`);
  }
  await addCheckpoint(session, { stage: "refactorer", iteration, note: "Refactorer applied cleanups", provider: refactorerRole.provider, model: refactorerRole.model || null });
  emitProgress(
    emitter,
    makeEvent("refactorer:end", { ...eventBase, stage: "refactorer" }, {
      message: "Refactorer completed"
    })
  );
}

export async function runTddCheckStage({ config, logger, emitter, eventBase, session, trackBudget, iteration, askQuestion }) {
  logger.setContext({ iteration, stage: "tdd" });
  const tddDiff = await generateDiff({ baseRef: session.session_start_sha });
  const tddEval = evaluateTddPolicy(tddDiff, config.development);
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
        testFiles: tddEval.testFiles?.length || 0
      }
    })
  );

  if (!tddEval.ok) {
    session.last_reviewer_feedback = tddEval.message;
    session.repeated_issue_count += 1;
    await saveSession(session);
    if (session.repeated_issue_count >= config.session.fail_fast_repeats) {
      const question = `TDD policy has failed ${session.repeated_issue_count} times. The coder is not creating tests. How should we proceed? Issue: ${tddEval.reason}`;
      if (askQuestion) {
        const answer = await askQuestion(question, { iteration, stage: "tdd" });
        if (answer) {
          session.last_reviewer_feedback += `\nUser guidance: ${answer}`;
          session.repeated_issue_count = 0;
          await saveSession(session);
          return { action: "continue" };
        }
      }
      await pauseSession(session, {
        question,
        context: {
          iteration,
          stage: "tdd",
          lastFeedback: tddEval.message,
          repeatedCount: session.repeated_issue_count
        }
      });
      emitProgress(
        emitter,
        makeEvent("question", { ...eventBase, stage: "tdd" }, {
          status: "paused",
          message: question,
          detail: { question, sessionId: session.id }
        })
      );
      return { action: "pause", result: { paused: true, sessionId: session.id, question, context: "tdd_fail_fast" } };
    }
    return { action: "continue" };
  }

  return { action: "ok" };
}

export async function runSonarStage({ config, logger, emitter, eventBase, session, trackBudget, iteration, repeatDetector, budgetSummary, sonarState, askQuestion, task }) {
  logger.setContext({ iteration, stage: "sonar" });
  emitProgress(
    emitter,
    makeEvent("sonar:start", { ...eventBase, stage: "sonar" }, {
      message: "SonarQube scanning"
    })
  );

  const sonarRole = new SonarRole({ config, logger, emitter });
  await sonarRole.init({ iteration });
  const sonarStart = Date.now();
  const sonarOutput = await sonarRole.run();
  trackBudget({ role: "sonar", provider: "sonar", result: sonarOutput, duration_ms: Date.now() - sonarStart });
  const sonarResult = sonarOutput.result;

  if (!sonarResult.gateStatus && sonarResult.error) {
    await markSessionStatus(session, "failed");
    emitProgress(
      emitter,
      makeEvent("sonar:end", { ...eventBase, stage: "sonar" }, {
        status: "fail",
        message: `Sonar scan failed: ${sonarResult.error}`
      })
    );
    throw new Error(`Sonar scan failed: ${sonarResult.error}`);
  }

  session.last_sonar_summary = sonarOutput.summary;
  if (typeof sonarResult.openIssuesTotal === "number") {
    if (sonarState.issuesInitial === null) {
      sonarState.issuesInitial = sonarResult.openIssuesTotal;
    }
    sonarState.issuesFinal = sonarResult.openIssuesTotal;
  }
  await addCheckpoint(session, {
    stage: "sonar",
    iteration,
    project_key: sonarResult.projectKey,
    quality_gate: sonarResult.gateStatus,
    open_issues: sonarResult.openIssuesTotal,
    provider: "sonar",
    model: null
  });

  emitProgress(
    emitter,
    makeEvent("sonar:end", { ...eventBase, stage: "sonar" }, {
      status: sonarResult.blocking ? "fail" : "ok",
      message: `Quality gate: ${sonarResult.gateStatus}`,
      detail: { projectKey: sonarResult.projectKey, gateStatus: sonarResult.gateStatus, openIssues: sonarResult.openIssuesTotal }
    })
  );

  if (sonarResult.blocking) {
    repeatDetector.addIteration(sonarResult.issues, []);
    const repeatState = repeatDetector.isStalled();
    if (repeatState.stalled) {
      const repeatCounts = repeatDetector.getRepeatCounts();
      const message = `No progress: SonarQube issues repeated ${repeatCounts.sonar} times.`;
      logger.warn(message);
      await markSessionStatus(session, "stalled");
      emitProgress(
        emitter,
        makeEvent("session:end", { ...eventBase, stage: "sonar" }, {
          status: "stalled",
          message,
          detail: { reason: repeatState.reason, repeats: repeatCounts.sonar, budget: budgetSummary() }
        })
      );
      return { action: "stalled", result: { approved: false, sessionId: session.id, reason: "stalled" } };
    }

    session.last_reviewer_feedback = `Sonar gate blocking (${sonarResult.gateStatus}). Resolve critical findings first.`;
    session.sonar_retry_count = (session.sonar_retry_count || 0) + 1;
    await saveSession(session);
    const maxSonarRetries = config.session.max_sonar_retries ?? config.session.fail_fast_repeats;
    if (session.sonar_retry_count >= maxSonarRetries) {
      emitProgress(
        emitter,
        makeEvent("solomon:escalate", { ...eventBase, stage: "sonar" }, {
          message: `Sonar sub-loop limit reached (${session.sonar_retry_count}/${maxSonarRetries})`,
          detail: { subloop: "sonar", retryCount: session.sonar_retry_count, limit: maxSonarRetries, gateStatus: sonarResult.gateStatus }
        })
      );

      const solomonResult = await invokeSolomon({
        config, logger, emitter, eventBase, stage: "sonar", askQuestion, session, iteration,
        conflict: {
          stage: "sonar",
          task,
          iterationCount: session.sonar_retry_count,
          maxIterations: maxSonarRetries,
          history: [{ agent: "sonar", feedback: session.last_sonar_summary }]
        }
      });

      if (solomonResult.action === "pause") {
        return { action: "pause", result: { paused: true, sessionId: session.id, question: solomonResult.question, context: "sonar_fail_fast" } };
      }
      if (solomonResult.action === "continue") {
        if (solomonResult.humanGuidance) {
          session.last_reviewer_feedback += `\nUser guidance: ${solomonResult.humanGuidance}`;
        }
        session.sonar_retry_count = 0;
        await saveSession(session);
        return { action: "continue" };
      }
      if (solomonResult.action === "subtask") {
        return { action: "pause", result: { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "sonar_subtask" } };
      }
    }
    return { action: "continue" };
  }

  // Sonar passed — reset retry counter
  session.sonar_retry_count = 0;
  const issuesInitial = sonarState.issuesInitial ?? sonarResult.openIssuesTotal ?? 0;
  const issuesFinal = sonarState.issuesFinal ?? sonarResult.openIssuesTotal ?? 0;
  const stageResult = {
    gateStatus: sonarResult.gateStatus,
    openIssues: sonarResult.openIssuesTotal,
    issuesInitial,
    issuesFinal,
    issuesResolved: Math.max(issuesInitial - issuesFinal, 0)
  };

  return { action: "ok", stageResult };
}

export async function runReviewerStage({ reviewerRole, config, logger, emitter, eventBase, session, trackBudget, iteration, reviewRules, task, repeatDetector, budgetSummary, askQuestion }) {
  logger.setContext({ iteration, stage: "reviewer" });
  emitProgress(
    emitter,
    makeEvent("reviewer:start", { ...eventBase, stage: "reviewer" }, {
      message: `Reviewer (${reviewerRole.provider}) running`,
      detail: { reviewer: reviewerRole.provider }
    })
  );

  const diff = await generateDiff({ baseRef: session.session_start_sha });
  const reviewerOnOutput = ({ stream, line }) => {
    emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "reviewer" }, {
      message: line,
      detail: { stream, agent: reviewerRole.provider }
    }));
  };
  const reviewerStall = createStallDetector({
    onOutput: reviewerOnOutput, emitter, eventBase, stage: "reviewer", provider: reviewerRole.provider
  });
  const reviewerStart = Date.now();
  let reviewerExec;
  try {
    reviewerExec = await runReviewerWithFallback({
      reviewerName: reviewerRole.provider,
      config,
      logger,
      emitter,
      reviewInput: { task, diff, reviewRules, onOutput: reviewerStall.onOutput },
      session,
      iteration,
      onAttemptResult: ({ reviewer, result }) => {
        trackBudget({ role: "reviewer", provider: reviewer, model: reviewerRole.model, result, duration_ms: Date.now() - reviewerStart });
      }
    });
  } finally {
    reviewerStall.stop();
  }

  if (!reviewerExec.execResult || !reviewerExec.execResult.ok) {
    const lastAttempt = reviewerExec.attempts.at(-1);
    const details =
      lastAttempt?.result?.error ||
      lastAttempt?.execResult?.summary ||
      `reviewer=${lastAttempt?.reviewer || "unknown"}`;

    const rateLimitCheck = detectRateLimit({
      stderr: lastAttempt?.result?.error || "",
      stdout: lastAttempt?.result?.output || ""
    });

    if (rateLimitCheck.isRateLimit) {
      // Enter standby instead of pausing
      return {
        action: "standby",
        standbyInfo: {
          agent: reviewerRole.provider,
          cooldownMs: rateLimitCheck.cooldownMs,
          cooldownUntil: rateLimitCheck.cooldownUntil,
          message: rateLimitCheck.message
        }
      };
    }

    await markSessionStatus(session, "failed");
    emitProgress(
      emitter,
      makeEvent("reviewer:end", { ...eventBase, stage: "reviewer" }, {
        status: "fail",
        message: `Reviewer failed: ${details}`
      })
    );
    throw new Error(`Reviewer failed: ${details}`);
  }

  const reviewResult = reviewerExec.execResult.result;
  let review;
  try {
    review = validateReviewResult({
      approved: reviewResult.approved,
      blocking_issues: reviewResult.blocking_issues || [],
      non_blocking_suggestions: reviewResult.non_blocking_suggestions || [],
      summary: reviewResult.raw_summary || "",
      confidence: reviewResult.confidence ?? 0
    });
  } catch (parseErr) {
    logger.warn(`Reviewer output validation failed: ${parseErr.message}`);
    review = {
      approved: false,
      blocking_issues: [{
        id: "PARSE_ERROR",
        severity: "high",
        description: `Reviewer output could not be parsed: ${parseErr.message}`
      }],
      non_blocking_suggestions: [],
      summary: `Parse error: ${parseErr.message}`,
      confidence: 0
    };
  }
  // --- Scope filter: auto-defer out-of-scope blocking issues ---
  const { review: filteredReview, demoted, deferred, allDemoted } = filterReviewScope(review, diff);
  review = filteredReview;

  if (demoted.length > 0) {
    logger.info(`Scope filter: deferred ${demoted.length} out-of-scope issue(s)${allDemoted ? " — auto-approved" : ""}`);

    // Accumulate deferred issues in session for tracking
    if (!session.deferred_issues) session.deferred_issues = [];
    session.deferred_issues.push(...deferred);
    await saveSession(session);

    emitProgress(
      emitter,
      makeEvent("reviewer:scope_filter", { ...eventBase, stage: "reviewer" }, {
        message: `Scope filter deferred ${demoted.length} out-of-scope issue(s)`,
        detail: {
          demotedCount: demoted.length,
          autoApproved: allDemoted,
          totalDeferred: session.deferred_issues.length,
          deferred: deferred.map(d => ({ file: d.file, id: d.id, description: d.description }))
        }
      })
    );
    await addCheckpoint(session, {
      stage: "reviewer-scope-filter",
      iteration,
      demoted_count: demoted.length,
      auto_approved: allDemoted,
      total_deferred: session.deferred_issues.length
    });
  }

  await addCheckpoint(session, {
    stage: "reviewer",
    iteration,
    approved: review.approved,
    blocking_issues: review.blocking_issues.length,
    provider: reviewerRole.provider,
    model: reviewerRole.model || null
  });

  emitProgress(
    emitter,
    makeEvent("reviewer:end", { ...eventBase, stage: "reviewer" }, {
      status: review.approved ? "ok" : "fail",
      message: review.approved ? "Review approved" : `Review rejected (${review.blocking_issues.length} blocking)`,
      detail: {
        approved: review.approved,
        blockingCount: review.blocking_issues.length,
        issues: review.blocking_issues.map(
          (x) => `${x.id || "ISSUE"}: ${x.description || "Missing description"}`
        )
      }
    })
  );

  if (!review.approved) {
    repeatDetector.addIteration([], review.blocking_issues);
    const repeatState = repeatDetector.isStalled();
    if (repeatState.stalled) {
      const repeatCounts = repeatDetector.getRepeatCounts();

      // --- Solomon mediation for stalled reviewer ---
      // Instead of immediately stopping, let Solomon arbitrate
      logger.warn(`Reviewer stalled (${repeatCounts.reviewer} repeats). Invoking Solomon mediation.`);
      emitProgress(
        emitter,
        makeEvent("solomon:escalate", { ...eventBase, stage: "reviewer" }, {
          message: `Reviewer stalled — Solomon mediating`,
          detail: { repeats: repeatCounts.reviewer, reason: repeatState.reason }
        })
      );

      const solomonResult = await invokeSolomon({
        config, logger, emitter, eventBase, stage: "reviewer", askQuestion, session, iteration,
        conflict: {
          stage: "reviewer",
          task,
          iterationCount: repeatCounts.reviewer,
          maxIterations: config.session?.fail_fast_repeats ?? 2,
          stalledReason: repeatState.reason,
          blockingIssues: review.blocking_issues,
          history: [{ agent: "reviewer", feedback: review.blocking_issues.map(x => x.description).join("; ") }]
        }
      });

      if (solomonResult.action === "pause") {
        await markSessionStatus(session, "stalled");
        return { review, stalled: true, stalledResult: { paused: true, sessionId: session.id, question: solomonResult.question, context: "reviewer_stalled" } };
      }
      if (solomonResult.action === "continue") {
        // Solomon says continue — reset repeat detector for reviewer
        repeatDetector.reviewer = { lastHash: null, repeatCount: 0 };
        if (solomonResult.humanGuidance) {
          session.last_reviewer_feedback = `Solomon/user guidance: ${solomonResult.humanGuidance}`;
          await saveSession(session);
        }
        return { review };
      }
      if (solomonResult.action === "subtask") {
        return { review, stalled: true, stalledResult: { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "reviewer_subtask" } };
      }

      // Fallback: original stall behavior
      const message = `Manual intervention required: reviewer issues repeated ${repeatCounts.reviewer} times.`;
      await markSessionStatus(session, "stalled");
      emitProgress(
        emitter,
        makeEvent("session:end", { ...eventBase, stage: "reviewer" }, {
          status: "stalled",
          message,
          detail: { reason: repeatState.reason, repeats: repeatCounts.reviewer, budget: budgetSummary() }
        })
      );
      return { review, stalled: true, stalledResult: { approved: false, sessionId: session.id, reason: "stalled" } };
    }
  }

  return { review };
}
