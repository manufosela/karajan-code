/**
 * Reviewer stage logic + fetchReviewDiff.
 * Extracted from iteration-stages.js for maintainability.
 */

import { addCheckpoint, markSessionStatus, saveSession } from "../../session-store.js";
import { generateDiff } from "../../review/diff-generator.js";
import { validateReviewResult } from "../../review/schema.js";
import { filterReviewScope, buildDeferredContext } from "../../review/scope-filter.js";
import { emitProgress, makeEvent } from "../../utils/events.js";
import { runReviewerWithFallback } from "../reviewer-fallback.js";
import { invokeSolomon } from "../solomon-escalation.js";
import { detectRateLimit } from "../../utils/rate-limit-detector.js";
import { createStallDetector } from "../../utils/stall-detector.js";

function categorizeIssues(issues) {
  const categories = { security: 0, correctness: 0, tests: 0, style: 0, other: 0 };
  const securityKw = /inject(?:ion)?|xss|csrf|secret.?leak|credential.?expos|auth(?:entication|orization).?(?:bypass|fail|miss|broken|weak)|vulnerab|exploit|httponly|token.?expos/i;
  const styleKw = /naming|name|rename|style|format|indent|spacing|convention|cosmetic|readability|comment|jsdoc|whitespace/i;
  const testKw = /test|coverage|assert|spec|mock/i;

  for (const issue of issues || []) {
    const desc = issue.description || "";
    const sev = (issue.severity || "").toLowerCase();
    if (sev === "critical" || securityKw.test(desc)) categories.security++;
    else if (testKw.test(desc)) categories.tests++;
    else if (sev === "low" || sev === "minor" || styleKw.test(desc)) categories.style++;
    else categories.correctness++;
  }
  return categories;
}

function buildReviewHistory(session) {
  return (session.checkpoints || [])
    .filter(cp => cp.stage === "reviewer")
    .map(cp => ({ iteration: cp.iteration, note: cp.note || "" }));
}

async function handleReviewerStalledSolomon({ review, repeatCounts, repeatState, config, logger, emitter, eventBase, session, iteration, task, askQuestion, budgetSummary, repeatDetector }) {
  // DETERMINISTIC GUARD: security issues NEVER go to Solomon — always return to coder
  const categories = categorizeIssues(review.blocking_issues);
  if (categories.security > 0) {
    logger.info(`Reviewer found ${categories.security} security issue(s) — returning to coder (Solomon bypassed)`);
    emitProgress(emitter, makeEvent("reviewer:security-block", { ...eventBase, stage: "reviewer" }, {
      message: `${categories.security} security issue(s) detected — must be fixed before approval`,
      detail: { securityCount: categories.security, blockingIssues: review.blocking_issues }
    }));
    return { review, solomonApproved: false };
  }

  const logPrefix = repeatState.stalled
    ? `Reviewer stalled (${repeatCounts.reviewer} repeats)`
    : `Reviewer rejected (first rejection)`;
  logger.warn(`${logPrefix}. Invoking Solomon mediation.`);
  emitProgress(
    emitter,
    makeEvent("solomon:escalate", { ...eventBase, stage: "reviewer" }, {
      message: `${logPrefix} — Solomon mediating`,
      detail: { repeats: repeatCounts.reviewer || 1, reason: repeatState.reason || "first_rejection" }
    })
  );

  const solomonResult = await invokeSolomon({
    config, logger, emitter, eventBase, stage: "reviewer", askQuestion, session, iteration,
    conflict: {
      stage: "reviewer",
      task,
      iterationCount: repeatCounts.reviewer || 1,
      maxIterations: config.session?.fail_fast_repeats ?? 2,
      isFirstRejection: !repeatState.stalled,
      isRepeat: repeatState.stalled,
      stalledReason: repeatState.reason || "first_rejection",
      blockingIssues: review.blocking_issues,
      issueCategories: categorizeIssues(review.blocking_issues),
      history: [
        ...buildReviewHistory(session),
        { agent: "reviewer", feedback: review.blocking_issues.map(x => x.description).join("; ") }
      ]
    }
  });

  if (solomonResult.action === "approve") {
    logger.info("Solomon overrode reviewer — approving code");
    emitProgress(emitter, makeEvent("solomon:override", { ...eventBase, stage: "solomon" }, {
      message: "Solomon overrode reviewer rejection — code approved",
      detail: { ruling: solomonResult.ruling?.result?.ruling }
    }));
    return { review: { ...review, approved: true, solomon_override: true }, solomonApproved: true };
  }
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
  const message = `Manual intervention required: reviewer issues repeated ${repeatCounts.reviewer || 1} times.`;
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

async function handleReviewerRejection({ review, repeatDetector, config, logger, emitter, eventBase, session, iteration, task, askQuestion, budgetSummary, brainCtx }) {
  repeatDetector.addIteration([], review.blocking_issues);
  const repeatState = repeatDetector.isStalled();

  const solomonEnabled = Boolean(config.pipeline?.solomon?.enabled);

  // Brain: if enabled and bypass_solomon_on_correctness, push issues to queue and skip Solomon
  // for non-style rejections. Solomon is still consulted on genuine dilemmas (style-only, deadlock).
  if (brainCtx?.enabled && config.brain?.bypass_solomon_on_correctness !== false) {
    const cats = categorizeIssues(review.blocking_issues);
    const nonStyleIssues = cats.security + cats.correctness + cats.tests;
    const styleIssues = cats.style;
    // Only bypass if there ARE non-style issues (correctness, tests, security, or "other" is correctness)
    // If it's style-only, let Solomon evaluate whether to override
    if (nonStyleIssues > 0 || cats.other > 0) {
      const { processRoleOutput } = await import("../brain-coordinator.js");
      processRoleOutput(brainCtx, { roleName: "reviewer", output: review, iteration });
      logger.info(`Brain: reviewer rejected with ${nonStyleIssues} non-style issue(s) — bypassing Solomon, returning to coder`);
      emitProgress(emitter, makeEvent("brain:bypass-solomon", { ...eventBase, stage: "reviewer" }, {
        message: `Brain: ${nonStyleIssues} non-style issue(s) — sending to coder without Solomon`,
        detail: { categories: cats, queueSize: brainCtx.feedbackQueue.entries.length }
      }));
      // Persist flat feedback for compat with non-Brain flow
      session.last_reviewer_feedback = review.blocking_issues
        .map((x, idx) => `R-${idx + 1} [${x.severity || "medium"}]: ${x.description}`)
        .join("\n");
      await saveSession(session);
      return null; // null = continue to next iteration (coder fixes)
    }
    logger.info("Brain: reviewer rejected with style-only issues — consulting Solomon for dilemma");
  }

  // When Solomon is disabled, only act on stalls (legacy behavior)
  if (!solomonEnabled) {
    if (!repeatState.stalled) return null;
    const repeatCounts = repeatDetector.getRepeatCounts();
    return handleReviewerStalledSolomon({
      review, repeatCounts, repeatState, config, logger, emitter,
      eventBase, session, iteration, task, askQuestion,
      budgetSummary, repeatDetector
    });
  }

  // Solomon evaluates EVERY rejection
  const repeatCounts = repeatDetector.getRepeatCounts();
  logger.info(`Reviewer rejected — Solomon evaluating ${review.blocking_issues.length} blocking issue(s)`);
  emitProgress(emitter, makeEvent("solomon:evaluate", { ...eventBase, stage: "solomon" }, {
    message: `Solomon evaluating reviewer rejection`,
    detail: { blockingCount: review.blocking_issues.length, isRepeat: repeatState.stalled }
  }));

  return handleReviewerStalledSolomon({
    review, repeatCounts, repeatState, config, logger, emitter,
    eventBase, session, iteration, task, askQuestion,
    budgetSummary, repeatDetector
  });
}

export async function fetchReviewDiff(session, logger) {
  if (session.ci_pr_number) {
    const { getPrDiff } = await import("../../ci/pr-diff.js");
    const diff = await getPrDiff(session.ci_pr_number);
    logger.info(`Reviewer reading PR diff #${session.ci_pr_number}`);
    return diff;
  }
  return generateDiff({ baseRef: session.session_start_sha, stageNewFiles: true });
}

export async function runReviewerStage({ reviewerRole, config, logger, emitter, eventBase, session, trackBudget, iteration, reviewRules, task, repeatDetector, budgetSummary, askQuestion, brainCtx }) {
  logger.setContext({ iteration, stage: "reviewer" });
  emitProgress(
    emitter,
    makeEvent("reviewer:start", { ...eventBase, stage: "reviewer" }, {
      message: `Reviewer (${reviewerRole.provider}) running`,
      detail: { reviewer: reviewerRole.provider, provider: reviewerRole.provider, executorType: "agent" }
    })
  );

  let diff;
  try {
    diff = await fetchReviewDiff(session, logger);
  } catch (err) {
    logger.warn(`Review diff generation failed: ${err.message}`);
    return { approved: false, blocking_issues: [{ description: `Diff generation failed: ${err.message}` }], non_blocking_suggestions: [], summary: `Reviewer failed: cannot generate diff — ${err.message}`, confidence: 0 };
  }

  // Injection guard: scan diff before sending to AI reviewer
  const { scanDiff } = await import("../../utils/injection-guard.js");
  const guardResult = scanDiff(diff);
  if (!guardResult.clean) {
    logger.warn(`Injection guard: ${guardResult.summary}`);
    emitProgress(emitter, makeEvent("guard:injection", { ...eventBase, stage: "reviewer" }, {
      message: `Injection guard blocked review: ${guardResult.summary}`,
      detail: { findings: guardResult.findings, summary: guardResult.summary }
    }));
    return {
      approved: false,
      blocking_issues: guardResult.findings.map((f) => ({
        id: `INJECTION_${f.type.toUpperCase()}`,
        severity: "critical",
        description: `Potential prompt injection (${f.type}): ${f.snippet}`,
        line: f.line,
      })),
      non_blocking_suggestions: [],
      summary: `Review blocked by injection guard: ${guardResult.summary}`,
      confidence: 1,
    };
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
      makeEvent("reviewer:end", { ...eventBase, stage: "reviewer" }, {
        status: "fail",
        message: `Reviewer failed: ${details}`,
        detail: { provider: reviewerRole.provider, executorType: "agent" }
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

  // Feedback signature for stale detection: concatenated issue descriptions
  const feedbackSignature = review.blocking_issues
    .map(x => (x.description || "").slice(0, 120))
    .join("|") || "approved";

  await addCheckpoint(session, {
    stage: "reviewer",
    iteration,
    approved: review.approved,
    blocking_issues: review.blocking_issues.length,
    provider: reviewerRole.provider,
    model: reviewerRole.model || null,
    note: feedbackSignature
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
        ),
        provider: reviewerRole.provider,
        executorType: "agent"
      }
    })
  );

  if (!review.approved) {
    const rejectionResult = await handleReviewerRejection({ review, repeatDetector, config, logger, emitter, eventBase, session, iteration, task, askQuestion, budgetSummary, brainCtx });
    if (rejectionResult) return rejectionResult;
  }

  return { review };
}
