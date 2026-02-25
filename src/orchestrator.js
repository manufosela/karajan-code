import { createAgent } from "./agents/index.js";
import {
  addCheckpoint,
  createSession,
  loadSession,
  markSessionStatus,
  pauseSession,
  resumeSessionWithAnswer,
  saveSession
} from "./session-store.js";
import { computeBaseRef, generateDiff } from "./review/diff-generator.js";
import { parseJsonOutput } from "./review/parser.js";
import { validateReviewResult } from "./review/schema.js";
import { evaluateTddPolicy } from "./review/tdd-policy.js";
import { buildCoderPrompt } from "./prompts/coder.js";
import { buildReviewerPrompt } from "./prompts/reviewer.js";
import { getOpenIssues, getQualityGateStatus } from "./sonar/api.js";
import { runSonarScan } from "./sonar/scanner.js";
import { shouldBlockByProfile, summarizeIssues } from "./sonar/enforcer.js";
import { resolveRole } from "./config.js";
import { RepeatDetector } from "./repeat-detector.js";
import { emitProgress, makeEvent } from "./utils/events.js";
import {
  commitMessageFromTask,
  prepareGitAutomation,
  finalizeGitAutomation
} from "./git/automation.js";
import { resolveRoleMdPath, loadFirstExisting } from "./roles/base-role.js";

function getRepeatThreshold(config) {
  const raw =
    config?.failFast?.repeatThreshold ??
    config?.session?.repeat_detection_threshold ??
    config?.session?.fail_fast_repeats ??
    2;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return value;
  return 2;
}

async function runReviewerWithFallback({ reviewerName, config, logger, prompt, session, iteration, onOutput }) {
  const fallbackReviewer = config.reviewer_options?.fallback_reviewer;
  const retries = Math.max(0, Number(config.reviewer_options?.retries ?? 1));
  const candidates = [reviewerName];
  if (fallbackReviewer && fallbackReviewer !== reviewerName) {
    candidates.push(fallbackReviewer);
  }

  const attempts = [];
  for (const name of candidates) {
    const reviewer = createAgent(name, config, logger);
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const result = await reviewer.reviewTask({ prompt, onOutput, role: "reviewer" });
      attempts.push({ reviewer: name, attempt, ok: result.ok, result });
      await addCheckpoint(session, {
        stage: "reviewer-attempt",
        iteration,
        reviewer: name,
        attempt,
        ok: result.ok
      });

      if (result.ok) {
        return { result, attempts };
      }
    }
  }

  return { result: null, attempts };
}

export async function runFlow({ task, config, logger, flags = {}, emitter = null, askQuestion = null }) {
  const plannerRole = resolveRole(config, "planner");
  const coderRole = resolveRole(config, "coder");
  const reviewerRole = resolveRole(config, "reviewer");
  const refactorerRole = resolveRole(config, "refactorer");
  const repeatDetector = new RepeatDetector({ threshold: getRepeatThreshold(config) });
  const plannerEnabled = Boolean(config.pipeline?.planner?.enabled);
  const refactorerEnabled = Boolean(config.pipeline?.refactorer?.enabled);
  const coder = createAgent(coderRole.provider, config, logger);
  const startedAt = Date.now();
  const eventBase = { sessionId: null, iteration: 0, stage: null, startedAt };

  const baseRef = await computeBaseRef({ baseBranch: config.base_branch, baseRef: flags.baseRef || null });
  const session = await createSession({
    task,
    config_snapshot: config,
    base_ref: baseRef,
    session_start_sha: baseRef,
    last_reviewer_feedback: null,
    repeated_issue_count: 0,
    sonar_retry_count: 0,
    reviewer_retry_count: 0,
    last_sonar_issue_signature: null,
    sonar_repeat_count: 0,
    last_reviewer_issue_signature: null,
    reviewer_repeat_count: 0
  });

  eventBase.sessionId = session.id;

  emitProgress(
    emitter,
    makeEvent("session:start", eventBase, {
      message: "Session started",
      detail: {
        task,
        coder: coderRole.provider,
        reviewer: reviewerRole.provider,
        maxIterations: config.max_iterations
      }
    })
  );

  let plannedTask = task;
  if (plannerEnabled) {
    logger.setContext({ iteration: 0, stage: "planner" });
    emitProgress(
      emitter,
      makeEvent("planner:start", { ...eventBase, stage: "planner" }, {
        message: `Planner (${plannerRole.provider}) running`,
        detail: { planner: plannerRole.provider }
      })
    );
    const planner = createAgent(plannerRole.provider, config, logger);
    const plannerPrompt = [
      "Create an implementation plan for this task.",
      "Return concise numbered steps focused on execution order and risk.",
      "",
      task
    ].join("\n");
    const plannerResult = await planner.runTask({ prompt: plannerPrompt, role: "planner" });
    if (!plannerResult.ok) {
      await markSessionStatus(session, "failed");
      const details = plannerResult.error || plannerResult.output || `exitCode=${plannerResult.exitCode ?? "unknown"}`;
      emitProgress(
        emitter,
        makeEvent("planner:end", { ...eventBase, stage: "planner" }, {
          status: "fail",
          message: `Planner failed: ${details}`
        })
      );
      throw new Error(`Planner failed: ${details}`);
    }
    if (plannerResult.output?.trim()) {
      plannedTask = `${task}\n\nExecution plan:\n${plannerResult.output.trim()}`;
    }
    emitProgress(
      emitter,
      makeEvent("planner:end", { ...eventBase, stage: "planner" }, {
        message: "Planner completed"
      })
    );
  }

  const gitCtx = await prepareGitAutomation({ config, task, logger, session });

  const projectDir = config.projectDir || process.cwd();
  const reviewRules = await loadFirstExisting(resolveRoleMdPath("reviewer", projectDir)) || "Focus on critical issues only.";
  const coderRules = await loadFirstExisting(resolveRoleMdPath("coder", projectDir));

  for (let i = 1; i <= config.max_iterations; i += 1) {
    const elapsedMinutes = (Date.now() - startedAt) / 60000;
    if (elapsedMinutes > config.session.max_total_minutes) {
      await markSessionStatus(session, "failed");
      emitProgress(
        emitter,
        makeEvent("session:end", { ...eventBase, iteration: i, stage: "timeout" }, {
          status: "fail",
          message: "Session timed out",
          detail: { approved: false, reason: "timeout" }
        })
      );
      throw new Error("Session timed out");
    }

    eventBase.iteration = i;
    const iterStart = Date.now();
    logger.setContext({ iteration: i, stage: "iteration" });

    emitProgress(
      emitter,
      makeEvent("iteration:start", { ...eventBase, stage: "iteration" }, {
        message: `Iteration ${i}/${config.max_iterations}`,
        detail: { iteration: i, maxIterations: config.max_iterations }
      })
    );

    logger.info(`Iteration ${i}/${config.max_iterations}`);

    // --- Coder ---
    logger.setContext({ iteration: i, stage: "coder" });
    emitProgress(
      emitter,
      makeEvent("coder:start", { ...eventBase, stage: "coder" }, {
        message: `Coder (${coderRole.provider}) running`,
        detail: { coder: coderRole.provider }
      })
    );

    const coderPrompt = buildCoderPrompt({
      task: plannedTask,
      reviewerFeedback: session.last_reviewer_feedback,
      sonarSummary: session.last_sonar_summary,
      coderRules,
      methodology: config.development?.methodology || "tdd"
    });
    const coderOnOutput = ({ stream, line }) => {
      emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "coder" }, {
        message: line,
        detail: { stream, agent: coderRole.provider }
      }));
    };
    const coderResult = await coder.runTask({ prompt: coderPrompt, onOutput: coderOnOutput, role: "coder" });

    if (!coderResult.ok) {
      await markSessionStatus(session, "failed");
      const details = coderResult.error || coderResult.output || `exitCode=${coderResult.exitCode ?? "unknown"}`;
      emitProgress(
        emitter,
        makeEvent("coder:end", { ...eventBase, stage: "coder" }, {
          status: "fail",
          message: `Coder failed: ${details}`
        })
      );
      throw new Error(`Coder failed: ${details}`);
    }

    await addCheckpoint(session, { stage: "coder", iteration: i, note: "Coder applied changes" });
    emitProgress(
      emitter,
      makeEvent("coder:end", { ...eventBase, stage: "coder" }, {
        message: "Coder completed"
      })
    );

    if (refactorerEnabled) {
      logger.setContext({ iteration: i, stage: "refactorer" });
      emitProgress(
        emitter,
        makeEvent("refactorer:start", { ...eventBase, stage: "refactorer" }, {
          message: `Refactorer (${refactorerRole.provider}) running`,
          detail: { refactorer: refactorerRole.provider }
        })
      );
      const refactorer = createAgent(refactorerRole.provider, config, logger);
      const refactorPrompt = [
        `Task context:\n${plannedTask}`,
        "",
        "Refactor the current changes for clarity and maintainability without changing behavior.",
        "Do not expand scope and keep tests green."
      ].join("\n");
      const refactorerOnOutput = ({ stream, line }) => {
        emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "refactorer" }, {
          message: line,
          detail: { stream, agent: refactorerRole.provider }
        }));
      };
      const refactorResult = await refactorer.runTask({
        prompt: refactorPrompt,
        onOutput: refactorerOnOutput,
        role: "refactorer"
      });
      if (!refactorResult.ok) {
        await markSessionStatus(session, "failed");
        const details = refactorResult.error || refactorResult.output || `exitCode=${refactorResult.exitCode ?? "unknown"}`;
        emitProgress(
          emitter,
          makeEvent("refactorer:end", { ...eventBase, stage: "refactorer" }, {
            status: "fail",
            message: `Refactorer failed: ${details}`
          })
        );
        throw new Error(`Refactorer failed: ${details}`);
      }
      await addCheckpoint(session, { stage: "refactorer", iteration: i, note: "Refactorer applied cleanups" });
      emitProgress(
        emitter,
        makeEvent("refactorer:end", { ...eventBase, stage: "refactorer" }, {
          message: "Refactorer completed"
        })
      );
    }

    // --- TDD Policy ---
    logger.setContext({ iteration: i, stage: "tdd" });
    const tddDiff = await generateDiff({ baseRef: session.session_start_sha });
    const tddEval = evaluateTddPolicy(tddDiff, config.development);
    await addCheckpoint(session, {
      stage: "tdd-policy",
      iteration: i,
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
          const answer = await askQuestion(question, { iteration: i, stage: "tdd" });
          if (answer) {
            session.last_reviewer_feedback += `\nUser guidance: ${answer}`;
            session.repeated_issue_count = 0;
            await saveSession(session);
            continue;
          }
        }
        await pauseSession(session, {
          question,
          context: {
            iteration: i,
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
        return { paused: true, sessionId: session.id, question, context: "tdd_fail_fast" };
      }
      continue;
    }

    // --- SonarQube ---
    if (config.sonarqube.enabled) {
      logger.setContext({ iteration: i, stage: "sonar" });
      emitProgress(
        emitter,
        makeEvent("sonar:start", { ...eventBase, stage: "sonar" }, {
          message: "SonarQube scanning"
        })
      );

      const scan = await runSonarScan(config);
      if (!scan.ok) {
        await markSessionStatus(session, "failed");
        emitProgress(
          emitter,
          makeEvent("sonar:end", { ...eventBase, stage: "sonar" }, {
            status: "fail",
            message: `Sonar scan failed: ${scan.stderr || scan.stdout}`
          })
        );
        throw new Error(`Sonar scan failed: ${scan.stderr || scan.stdout}`);
      }

      const gate = await getQualityGateStatus(config, scan.projectKey);
      const issues = await getOpenIssues(config, scan.projectKey);
      session.last_sonar_summary = `QualityGate=${gate.status}; Open issues=${issues.total}; ${summarizeIssues(issues.issues)}`;
      await addCheckpoint(session, {
        stage: "sonar",
        iteration: i,
        project_key: scan.projectKey,
        quality_gate: gate.status,
        open_issues: issues.total
      });

      const sonarBlocking = shouldBlockByProfile({
        gateStatus: gate.status,
        profile: config.sonarqube.enforcement_profile
      });

      emitProgress(
        emitter,
        makeEvent("sonar:end", { ...eventBase, stage: "sonar" }, {
          status: sonarBlocking ? "fail" : "ok",
          message: `Quality gate: ${gate.status}`,
          detail: { projectKey: scan.projectKey, gateStatus: gate.status, openIssues: issues.total }
        })
      );

      if (sonarBlocking) {
        repeatDetector.addIteration(issues.issues, []);
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
              detail: { reason: repeatState.reason, repeats: repeatCounts.sonar }
            })
          );
          return { approved: false, sessionId: session.id, reason: "stalled" };
        }

        session.last_reviewer_feedback = `Sonar gate blocking (${gate.status}). Resolve critical findings first.`;
        session.sonar_retry_count = (session.sonar_retry_count || 0) + 1;
        await saveSession(session);
        const maxSonarRetries = config.session.max_sonar_retries ?? config.session.fail_fast_repeats;
        if (session.sonar_retry_count >= maxSonarRetries) {
          emitProgress(
            emitter,
            makeEvent("solomon:escalate", { ...eventBase, stage: "sonar" }, {
              message: `Sonar sub-loop limit reached (${session.sonar_retry_count}/${maxSonarRetries})`,
              detail: { subloop: "sonar", retryCount: session.sonar_retry_count, limit: maxSonarRetries, gateStatus: gate.status }
            })
          );
          const question = `SonarQube quality gate has failed ${session.sonar_retry_count} times (${gate.status}). What should we do?`;
          if (askQuestion) {
            const answer = await askQuestion(question, { iteration: i, stage: "sonar" });
            if (answer) {
              session.last_reviewer_feedback += `\nUser guidance: ${answer}`;
              session.sonar_retry_count = 0;
              await saveSession(session);
              continue;
            }
          }
          await pauseSession(session, {
            question,
            context: {
              iteration: i,
              stage: "sonar",
              gateStatus: gate.status,
              openIssues: issues.total,
              retryCount: session.sonar_retry_count
            }
          });
          emitProgress(
            emitter,
            makeEvent("question", { ...eventBase, stage: "sonar" }, {
              status: "paused",
              message: question,
              detail: { question, sessionId: session.id }
            })
          );
          return { paused: true, sessionId: session.id, question, context: "sonar_fail_fast" };
        }
        continue;
      }

      // Sonar passed — reset retry counter
      session.sonar_retry_count = 0;
    }

    // --- Reviewer ---
    logger.setContext({ iteration: i, stage: "reviewer" });
    emitProgress(
      emitter,
      makeEvent("reviewer:start", { ...eventBase, stage: "reviewer" }, {
        message: `Reviewer (${reviewerRole.provider}) running`,
        detail: { reviewer: reviewerRole.provider }
      })
    );

    const diff = await generateDiff({ baseRef: session.session_start_sha });
    const reviewerPrompt = buildReviewerPrompt({
      task,
      diff,
      reviewRules,
      mode: config.review_mode
    });
    const reviewerOnOutput = ({ stream, line }) => {
      emitProgress(emitter, makeEvent("agent:output", { ...eventBase, stage: "reviewer" }, {
        message: line,
        detail: { stream, agent: reviewerRole.provider }
      }));
    };
    const reviewerExec = await runReviewerWithFallback({
      reviewerName: reviewerRole.provider,
      config,
      logger,
      prompt: reviewerPrompt,
      session,
      iteration: i,
      onOutput: reviewerOnOutput
    });

    if (!reviewerExec.result || !reviewerExec.result.ok) {
      await markSessionStatus(session, "failed");
      const lastAttempt = reviewerExec.attempts.at(-1);
      const details =
        lastAttempt?.result?.error ||
        lastAttempt?.result?.output ||
        `reviewer=${lastAttempt?.reviewer || "unknown"} exitCode=${lastAttempt?.result?.exitCode ?? "unknown"}`;
      emitProgress(
        emitter,
        makeEvent("reviewer:end", { ...eventBase, stage: "reviewer" }, {
          status: "fail",
          message: `Reviewer failed: ${details}`
        })
      );
      throw new Error(`Reviewer failed: ${details}`);
    }

    const parsed = parseJsonOutput(reviewerExec.result.output);
    if (!parsed) {
      await markSessionStatus(session, "failed");
      emitProgress(
        emitter,
        makeEvent("reviewer:end", { ...eventBase, stage: "reviewer" }, {
          status: "fail",
          message: "Reviewer output is not valid JSON"
        })
      );
      throw new Error("Reviewer output is not valid JSON");
    }

    const review = validateReviewResult(parsed);
    await addCheckpoint(session, {
      stage: "reviewer",
      iteration: i,
      approved: review.approved,
      blocking_issues: review.blocking_issues.length
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
        const message = `Manual intervention required: reviewer issues repeated ${repeatCounts.reviewer} times.`;
        logger.warn(message);
        await markSessionStatus(session, "stalled");
        emitProgress(
          emitter,
          makeEvent("session:end", { ...eventBase, stage: "reviewer" }, {
            status: "stalled",
            message,
            detail: { reason: repeatState.reason, repeats: repeatCounts.reviewer }
          })
        );
        return { approved: false, sessionId: session.id, reason: "stalled" };
      }
    }

    // --- Iteration end ---
    const iterDuration = Date.now() - iterStart;
    emitProgress(
      emitter,
      makeEvent("iteration:end", { ...eventBase, stage: "iteration" }, {
        message: `Iteration ${i} completed`,
        detail: { duration: iterDuration }
      })
    );

    if (review.approved) {
      session.reviewer_retry_count = 0;
      const gitResult = await finalizeGitAutomation({ config, gitCtx, task, logger, session });
      await markSessionStatus(session, "approved");
      emitProgress(
        emitter,
        makeEvent("session:end", { ...eventBase, stage: "done" }, {
          message: "Session approved",
          detail: { approved: true, git: gitResult }
        })
      );
      return { approved: true, sessionId: session.id, review, git: gitResult };
    }

    session.last_reviewer_feedback = review.blocking_issues
      .map((x) => `${x.id || "ISSUE"}: ${x.description || "Missing description"}`)
      .join("\n");
    session.reviewer_retry_count = (session.reviewer_retry_count || 0) + 1;
    await saveSession(session);

    const maxReviewerRetries = config.session.max_reviewer_retries ?? config.session.fail_fast_repeats;
    if (session.reviewer_retry_count >= maxReviewerRetries) {
      emitProgress(
        emitter,
        makeEvent("solomon:escalate", { ...eventBase, stage: "reviewer" }, {
          message: `Reviewer sub-loop limit reached (${session.reviewer_retry_count}/${maxReviewerRetries})`,
          detail: { subloop: "reviewer", retryCount: session.reviewer_retry_count, limit: maxReviewerRetries }
        })
      );
      const question = `Reviewer has rejected ${session.reviewer_retry_count} times with the same issues. Blocking issues:\n${session.last_reviewer_feedback}\n\nHow should we proceed?`;
      if (askQuestion) {
        const answer = await askQuestion(question, { iteration: i, stage: "reviewer" });
        if (answer) {
          session.last_reviewer_feedback += `\nUser guidance: ${answer}`;
          session.reviewer_retry_count = 0;
          await saveSession(session);
          continue;
        }
      }
      await pauseSession(session, {
        question,
        context: {
          iteration: i,
          stage: "reviewer",
          lastFeedback: session.last_reviewer_feedback,
          retryCount: session.reviewer_retry_count
        }
      });
      emitProgress(
        emitter,
        makeEvent("question", { ...eventBase, stage: "reviewer" }, {
          status: "paused",
          message: question,
          detail: { question, sessionId: session.id }
        })
      );
      return { paused: true, sessionId: session.id, question, context: "reviewer_fail_fast" };
    }
  }

  await markSessionStatus(session, "failed");
  emitProgress(
    emitter,
    makeEvent("session:end", { ...eventBase, stage: "done" }, {
      status: "fail",
      message: "Max iterations reached",
      detail: { approved: false, reason: "max_iterations" }
    })
  );
  return { approved: false, sessionId: session.id, reason: "max_iterations" };
}

export async function resumeFlow({ sessionId, answer, config, logger, flags = {}, emitter = null, askQuestion = null }) {
  const session = answer
    ? await resumeSessionWithAnswer(sessionId, answer)
    : await loadSession(sessionId);

  if (session.status === "paused" && !answer) {
    logger.info(`Session ${sessionId} is paused. Provide --answer to resume.`);
    return session;
  }

  if (session.status !== "running") {
    logger.info(`Session ${sessionId} has status ${session.status}`);
    return session;
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
    session.last_reviewer_feedback = `Previous feedback: ${session.paused_state.context.lastFeedback}\nUser guidance: ${answer}`;
  }
  session.repeated_issue_count = 0;
  session.sonar_retry_count = 0;
  session.reviewer_retry_count = 0;
  session.last_sonar_issue_signature = null;
  session.sonar_repeat_count = 0;
  session.last_reviewer_issue_signature = null;
  session.reviewer_repeat_count = 0;
  await saveSession(session);

  // Re-run the flow with the existing session context
  return runFlow({ task, config: sessionConfig, logger, flags, emitter, askQuestion });
}
