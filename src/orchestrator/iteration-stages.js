import { createAgent } from "../agents/index.js";
import { CoderRole } from "../roles/coder-role.js";
import { RefactorerRole } from "../roles/refactorer-role.js";
import { SonarRole } from "../roles/sonar-role.js";
import { addCheckpoint, markSessionStatus, saveSession } from "../session-store.js";
import { generateDiff, getUntrackedFiles } from "../review/diff-generator.js";
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
  const tddEval = evaluateTddPolicy(tddDiff, config.development, untrackedFiles);
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
    return handleTddFailure({ tddEval, config, logger, emitter, eventBase, session, iteration, askQuestion });
  }

  return { action: "ok" };
}

async function handleSonarStalled({ repeatDetector, logger, emitter, eventBase, session, budgetSummary }) {
  const repeatCounts = repeatDetector.getRepeatCounts();
  const message = `No progress: SonarQube issues repeated ${repeatCounts.sonar} times.`;
  logger.warn(message);
  await markSessionStatus(session, "stalled");
  const repeatState = repeatDetector.isStalled();
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

async function handleSonarRetryLimit({ config, logger, emitter, eventBase, session, iteration, askQuestion, task, maxSonarRetries, sonarResult }) {
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

  const actionResult = handleSolomonAction(solomonResult, session, "sonar");
  if (actionResult) return actionResult;
  const continued = await handleSolomonContinue(solomonResult, session, "sonar_retry_count");
  if (continued) return { action: "continue" };

  return null;
}

async function handleSonarBlocking({ sonarResult, config, logger, emitter, eventBase, session, iteration, repeatDetector, budgetSummary, askQuestion, task }) {
  // If the ONLY quality gate failure is coverage, treat as non-blocking warning
  if (sonarResult.conditions) {
    const failedConditions = sonarResult.conditions.filter(c => c.status === "ERROR");
    const onlyCoverage = failedConditions.length > 0 && failedConditions.every(c =>
      c.metricKey === "new_coverage" || c.metricKey === "coverage"
    );
    if (onlyCoverage) {
      logger.warn("Quality gate failed on coverage only — treating as advisory (code quality is clean)");
      emitProgress(emitter, makeEvent("sonar:end", { ...eventBase, stage: "sonar" }, {
        status: "warn",
        message: "Quality gate: coverage below threshold (advisory — code quality is clean)"
      }));
      session.last_reviewer_feedback = null;
      return { action: "ok", stageResult: { gateStatus: "WARN_COVERAGE", advisory: true } };
    }
  }

  repeatDetector.addIteration(sonarResult.issues, []);
  const repeatState = repeatDetector.isStalled();
  if (repeatState.stalled) {
    return handleSonarStalled({ repeatDetector, logger, emitter, eventBase, session, budgetSummary });
  }

  session.last_reviewer_feedback = `Sonar gate blocking (${sonarResult.gateStatus}). Resolve critical findings first.`;
  session.sonar_retry_count = (session.sonar_retry_count || 0) + 1;
  await saveSession(session);
  const maxSonarRetries = config.session.max_sonar_retries ?? config.session.fail_fast_repeats;

  if (session.sonar_retry_count >= maxSonarRetries) {
    const result = await handleSonarRetryLimit({ config, logger, emitter, eventBase, session, iteration, askQuestion, task, maxSonarRetries, sonarResult });
    if (result) return result;
  }

  return { action: "continue" };
}

export async function runSonarStage({ config, logger, emitter, eventBase, session, trackBudget, iteration, repeatDetector, budgetSummary, sonarState, askQuestion, task }) {
  logger.setContext({ iteration, stage: "sonar" });
  emitProgress(
    emitter,
    makeEvent("sonar:start", { ...eventBase, stage: "sonar" }, {
      message: "SonarQube scanning"
    })
  );

  // Auto-manage SonarQube: ensure it is reachable before scanning
  const { sonarUp, isSonarReachable } = await import("../sonar/manager.js");
  const sonarHost = config.sonarqube?.host || "http://localhost:9000";

  if (!await isSonarReachable(sonarHost)) {
    logger.info("SonarQube not reachable, attempting to start...");
    emitProgress(emitter, makeEvent("sonar:start", { ...eventBase, stage: "sonar" }, { message: "Starting SonarQube Docker..." }));

    const upResult = await sonarUp(sonarHost);
    if (upResult.exitCode !== 0) {
      logger.warn(`SonarQube could not be started: ${upResult.stderr || upResult.stdout}`);
      emitProgress(emitter, makeEvent("sonar:end", { ...eventBase, stage: "sonar" }, {
        status: "skip",
        message: "SonarQube not available — install Docker and run 'kj sonar start' to enable static analysis"
      }));
      return { action: "ok", stageResult: { gateStatus: "SKIPPED", reason: "SonarQube not available" } };
    }

    let ready = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise(r => setTimeout(r, 5000));
      if (await isSonarReachable(sonarHost)) { ready = true; break; }
    }
    if (!ready) {
      logger.warn("SonarQube started but not ready after 60s");
      emitProgress(emitter, makeEvent("sonar:end", { ...eventBase, stage: "sonar" }, {
        status: "skip", message: "SonarQube started but not ready — will retry next iteration"
      }));
      return { action: "ok", stageResult: { gateStatus: "PENDING", reason: "SonarQube starting up" } };
    }
    logger.info("SonarQube is ready");
  }

  const sonarRole = new SonarRole({ config, logger, emitter });
  await sonarRole.init({ iteration });
  const sonarStart = Date.now();
  let sonarOutput;
  try {
    sonarOutput = await sonarRole.run();
  } catch (err) {
    logger.warn(`Sonar threw: ${err.message}`);
    sonarOutput = { ok: false, result: { error: err.message }, summary: `Sonar error: ${err.message}` };
  }
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
    return handleSonarBlocking({ sonarResult, config, logger, emitter, eventBase, session, iteration, repeatDetector, budgetSummary, askQuestion, task });
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

export async function runSonarCloudStage({ config, logger, emitter, eventBase, session, trackBudget, iteration }) {
  logger.setContext({ iteration, stage: "sonarcloud" });
  emitProgress(
    emitter,
    makeEvent("sonarcloud:start", { ...eventBase, stage: "sonarcloud" }, {
      message: "SonarCloud scanning"
    })
  );

  const { runSonarCloudScan } = await import("../sonar/cloud-scanner.js");
  const scanStart = Date.now();
  let result;
  try {
    result = await runSonarCloudScan(config);
  } catch (err) {
    logger.warn(`SonarCloud threw: ${err.message}`);
    result = { ok: false, error: err.message };
  }
  trackBudget({ role: "sonarcloud", provider: "sonarcloud", result: { ok: result.ok }, duration_ms: Date.now() - scanStart });

  await addCheckpoint(session, {
    stage: "sonarcloud",
    iteration,
    project_key: result.projectKey,
    exitCode: result.exitCode,
    provider: "sonarcloud",
    model: null
  });

  const status = result.ok ? "ok" : "warn";
  const message = result.ok
    ? `SonarCloud scan passed (project: ${result.projectKey})`
    : `SonarCloud scan issue: ${(result.stderr || "").slice(0, 200)}`;

  emitProgress(
    emitter,
    makeEvent("sonarcloud:end", { ...eventBase, stage: "sonarcloud" }, {
      status,
      message,
      detail: { projectKey: result.projectKey, exitCode: result.exitCode }
    })
  );

  // SonarCloud is advisory — never blocks the pipeline
  return { action: "ok", stageResult: { ok: result.ok, projectKey: result.projectKey, message } };
}

async function handleReviewerStalledSolomon({ review, repeatCounts, repeatState, config, logger, emitter, eventBase, session, iteration, task, askQuestion, budgetSummary, repeatDetector }) {
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

  // Fallback
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

async function handleReviewerRejection({ review, repeatDetector, config, logger, emitter, eventBase, session, iteration, task, askQuestion, budgetSummary }) {
  repeatDetector.addIteration([], review.blocking_issues);
  const repeatState = repeatDetector.isStalled();
  if (!repeatState.stalled) return null;

  const repeatCounts = repeatDetector.getRepeatCounts();
  return handleReviewerStalledSolomon({ review, repeatCounts, repeatState, config, logger, emitter, eventBase, session, iteration, task, askQuestion, budgetSummary, repeatDetector });
}

async function fetchReviewDiff(session, logger) {
  if (session.becaria_pr_number) {
    const { getPrDiff } = await import("../becaria/pr-diff.js");
    const diff = await getPrDiff(session.becaria_pr_number);
    logger.info(`Reviewer reading PR diff #${session.becaria_pr_number}`);
    return diff;
  }
  return generateDiff({ baseRef: session.session_start_sha });
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

  let diff;
  try {
    diff = await fetchReviewDiff(session, logger);
  } catch (err) {
    logger.warn(`Review diff generation failed: ${err.message}`);
    return { approved: false, blocking_issues: [{ description: `Diff generation failed: ${err.message}` }], non_blocking_suggestions: [], summary: `Reviewer failed: cannot generate diff — ${err.message}`, confidence: 0 };
  }
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
  } catch (err) {
    logger.warn(`Reviewer threw: ${err.message}`);
    reviewerExec = { execResult: { ok: false, error: err.message }, attempts: [{ reviewer: reviewerRole.provider, result: { ok: false, error: err.message } }] };
  } finally {
    reviewerStall.stop();
  }

  if (!reviewerExec.execResult?.ok) {
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
  } catch (error_) {
    logger.warn(`Reviewer output validation failed: ${error_.message}`);
    review = {
      approved: false,
      blocking_issues: [{
        id: "PARSE_ERROR",
        severity: "high",
        description: `Reviewer output could not be parsed: ${error_.message}`
      }],
      non_blocking_suggestions: [],
      summary: `Parse error: ${error_.message}`,
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
    const rejectionResult = await handleReviewerRejection({ review, repeatDetector, config, logger, emitter, eventBase, session, iteration, task, askQuestion, budgetSummary });
    if (rejectionResult) return rejectionResult;
  }

  return { review };
}
