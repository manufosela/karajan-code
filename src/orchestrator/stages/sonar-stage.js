/**
 * Sonar stage logic + sonar retry logic.
 * Extracted from iteration-stages.js for maintainability.
 */

import { SonarRole } from "../../roles/sonar-role.js";
import { addCheckpoint, markSessionStatus, saveSession } from "../../session/store.js";
import {
  setReviewerFeedback, setSonarSummary, resetRetryCount, incrementRetryCount,
} from "../../session/mutators.js";
import { emitProgress, makeEvent } from "../../utils/events.js";
import { invokeSolomon } from "../solomon-escalation.js";
import { sonarUp, isSonarReachable } from "../../sonar/manager.js";
import { canResolveSonarProjectKey } from "../../sonar/project-key.js";
import { addEntries } from "../feedback-queue.js";

/**
 * Detect sonar errors that are caused by a malformed `sonar-project.properties`
 * (or equivalent CLI args) — i.e. the scanner refused to start at all because
 * a path is wrong, a key is missing, or a value is invalid. These are NOT
 * findings about user code; they're the coder's own configuration mistake.
 *
 * When this fires, the right move is to send a precise diagnostic to the
 * coder so it fixes the config in the next iteration. Bypassing with the
 * Brain (or Solomon) on a config error means iterating 5 times against the
 * same wall — Sonar can't possibly succeed until the config is fixed.
 *
 * Returns a string with actionable guidance, or null when the error is a
 * different category (auth, network, scanner crash) that the coder can't
 * resolve from inside the codebase.
 */
function detectSonarConfigError(rawError) {
  if (!rawError || typeof rawError !== "string") return null;

  // "Invalid value of sonar.tests for X — The folder 'tests' does not exist"
  // (and its sonar.sources / sonar.exclusions / sonar.coverage.* siblings).
  const invalidPath = rawError.match(/Invalid value of (sonar\.\w[\w.]*) for [^\n]+\nERROR The folder '([^']+)' does not exist/);
  if (invalidPath) {
    const [, key, dir] = invalidPath;
    return [
      `The Sonar property \`${key}=${dir}\` in sonar-project.properties points to a directory that doesn't exist.`,
      `Fix one of these in the SAME iteration:`,
      ` - Create the \`${dir}/\` directory in the project root, or`,
      ` - Edit sonar-project.properties so \`${key}\` points to an existing directory, or`,
      ` - Remove the \`${key}\` line entirely if the project legitimately has no such folder.`,
      `Without this fix, Sonar will refuse to scan and the run will burn every remaining iteration on the same error.`,
    ].join("\n");
  }

  // Fallback patterns for other config-shaped failures.
  if (/Invalid value of sonar\./i.test(rawError)) {
    return `Sonar refused to start because of an invalid value in sonar-project.properties. Read the scanner's error above and fix the offending key in this iteration: ${rawError.slice(0, 300)}`;
  }
  if (/sonar-project\.properties.*not found/i.test(rawError) || /No project key/i.test(rawError)) {
    return `Sonar can't find a usable sonar-project.properties. Generate one at the project root with at minimum: sonar.projectKey, sonar.projectName, sonar.sources=src, and sonar.tests pointing to an EXISTING directory (or omit it).`;
  }
  return null;
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

async function handleSonarRetryLimit({ config, logger, emitter, eventBase, session, iteration, askQuestion, task, maxSonarRetries, sonarResult, brainCtx }) {
  // Brain: when enabled, skip Solomon — Brain handles via max_iterations
  if (brainCtx?.enabled) {
    logger.info("Brain: sonar retry limit reached — Brain will handle via max_iterations (Solomon bypassed)");
    emitProgress(emitter, makeEvent("brain:sonar-retry-limit", { ...eventBase, stage: "sonar" }, {
      message: `Sonar sub-loop limit reached (${session.sonar_retry_count}/${maxSonarRetries}) — Brain handling`,
      detail: { subloop: "sonar", retryCount: session.sonar_retry_count, limit: maxSonarRetries, gateStatus: sonarResult.gateStatus }
    }));
    resetRetryCount(session, "sonar");
    await saveSession(session);
    return { action: "continue" };
  }

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
  if (solomonResult.action === "subtask") {
    return { action: "pause", result: { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "sonar_subtask" } };
  }
  if (solomonResult.action === "continue") {
    if (solomonResult.humanGuidance) {
      setReviewerFeedback(session, `${session.last_reviewer_feedback}\nUser guidance: ${solomonResult.humanGuidance}`);
    }
    resetRetryCount(session, "sonar");
    await saveSession(session);
    return { action: "continue" };
  }

  return null;
}

async function handleSonarBlocking({ sonarResult, config, logger, emitter, eventBase, session, iteration, repeatDetector, budgetSummary, askQuestion, task, brainCtx }) {
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
      setReviewerFeedback(session, null);
      return { action: "ok", stageResult: { gateStatus: "WARN_COVERAGE", advisory: true } };
    }
  }

  repeatDetector.addIteration(sonarResult.issues, []);
  const repeatState = repeatDetector.isStalled();
  if (repeatState.stalled) {
    return handleSonarStalled({ repeatDetector, logger, emitter, eventBase, session, budgetSummary });
  }

  const summary = `Sonar gate blocking (${sonarResult.gateStatus}). Resolve critical findings first.`;
  setReviewerFeedback(session, summary);
  // Brain: push sonar feedback into queue when enabled
  if (brainCtx?.enabled) {
    const { processRoleOutput } = await import("../brain-coordinator.js");
    processRoleOutput(brainCtx, { roleName: "sonar", output: { verdict: "fail", summary }, iteration });
  }
  incrementRetryCount(session, "sonar");
  await saveSession(session);
  const maxSonarRetries = config.session.max_sonar_retries ?? config.session.fail_fast_repeats;

  if (session.sonar_retry_count >= maxSonarRetries) {
    const result = await handleSonarRetryLimit({ config, logger, emitter, eventBase, session, iteration, askQuestion, task, maxSonarRetries, sonarResult, brainCtx });
    if (result) return result;
  }

  return { action: "continue" };
}

export async function runSonarStage({ config, logger, emitter, eventBase, session, trackBudget, iteration, repeatDetector, budgetSummary, sonarState, askQuestion, task, brainCtx }) {
  // Required-input guards. Without these, the bug class that broke the
  // FASE-2 run on 2026-04-29 (run-hu-batch.js called runSonarStage
  // without sonarState) is silent: the stage threw `Cannot read
  // properties of undefined (reading 'issuesInitial')` later, the HU
  // sub-pipeline's catch swallowed it as "non-blocking", and the
  // Sonar gate effectively never ran. Failing fast here surfaces the
  // missing wiring at the first iteration so any new caller fixes it
  // before burning budget.
  if (!sonarState || typeof sonarState !== "object") {
    throw new Error("runSonarStage: `sonarState` is required (object with issuesInitial/issuesFinal slots — usually ctx.sonarState).");
  }
  if (!session) {
    throw new Error("runSonarStage: `session` is required.");
  }
  logger.setContext({ iteration, stage: "sonar" });
  emitProgress(
    emitter,
    makeEvent("sonar:start", { ...eventBase, stage: "sonar" }, {
      message: "SonarQube scanning",
      detail: { provider: "sonarqube", executorType: "local" }
    })
  );

  // Auto-manage SonarQube: ensure it is reachable before scanning
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

  // 2026-05-07 (N4 dogfooding): when the working tree has neither a git
  // remote nor an explicit `sonarqube.project_key`, the scanner inside
  // SonarRole would throw "Missing git remote.origin.url" — the Brain
  // logs that as a sonar error, the iteration cap is reached, and the
  // run finalises as "approved" by exhaustion fallback even though no
  // sonar gate ever ran. KJC-TSK-0373 silenced this for the audit
  // collector but the run loop hit it on the parallel code path.
  // Skipping cleanly here means the gate reports "SKIPPED" once and
  // the iteration loop progresses on the next stage.
  if (!await canResolveSonarProjectKey(config)) {
    logger.info("Sonar gate skipped: no git remote and no sonarqube.project_key configured");
    emitProgress(emitter, makeEvent("sonar:end", { ...eventBase, stage: "sonar" }, {
      status: "skip",
      message: "Sonar skipped — no git remote and no sonarqube.project_key configured (run `git remote add origin …` or set `sonarqube.project_key` to enable)"
    }));
    return { action: "ok", stageResult: { gateStatus: "SKIPPED", reason: "no git remote and no sonarqube.project_key configured" } };
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
    const isTokenError = /unable to resolve sonar token/i.test(sonarResult.error);
    const errorMessage = isTokenError
      ? "SonarQube is running but no authentication token is configured. Fix: run 'kj init' to configure it, or set KJ_SONAR_TOKEN env var, or add sonarqube.token to ~/.karajan/kj.config.yml."
      : `Sonar scan failed: ${sonarResult.error}`;

    emitProgress(
      emitter,
      makeEvent("sonar:end", { ...eventBase, stage: "sonar" }, {
        status: "fail",
        message: errorMessage
      })
    );

    // Brain: when enabled, skip Solomon for sonar errors — Brain handles via max_iterations.
    if (brainCtx?.enabled) {
      // BUT: if the error is a *configuration* mistake (sonar.tests pointing to a
      // missing folder, etc.), iterating won't help — Sonar will refuse to scan
      // again and again. Push a typed feedback entry into the brain queue so the
      // next coder iteration sees a concrete fix-this-config diagnostic AND so
      // handleMaxIterations doesn't auto-finalize as approved (config is a
      // "correctness" category — pending entries block approval).
      const configHint = detectSonarConfigError(sonarResult.error);
      if (configHint) {
        addEntries(brainCtx.feedbackQueue, [{
          source: "sonar",
          severity: "high",
          category: "correctness",
          description: configHint,
          iteration
        }]);
        setReviewerFeedback(session, configHint);
        logger.info("Brain: sonar config error detected — feeding fix-this-config diagnostic to coder");
        emitProgress(emitter, makeEvent("brain:sonar-config-error", { ...eventBase, stage: "sonar" }, {
          message: "Sonar refused to scan — config error fed back to coder",
          detail: { hint: configHint.slice(0, 240) }
        }));
        return { action: "continue" };
      }
      logger.info("Brain: sonar error — Brain will handle (Solomon bypassed)");
      emitProgress(emitter, makeEvent("brain:sonar-error", { ...eventBase, stage: "sonar" }, {
        message: `Sonar error — Brain handling: ${errorMessage.slice(0, 200)}`,
        detail: { error: errorMessage }
      }));
      return { action: "continue" };
    }

    // Let Solomon decide: continue without sonar or stop
    const solomonResult = await invokeSolomon({
      config, logger, emitter, eventBase, stage: "sonar_error", askQuestion, session, iteration,
      conflict: {
        stage: "sonar_error",
        task,
        iterationCount: iteration,
        maxIterations: config.max_iterations,
        history: [{ agent: "sonar", feedback: errorMessage }]
      }
    });

    if (solomonResult.action === "approve" || solomonResult.action === "continue") {
      logger.info(`Solomon decided to continue without SonarQube: ${solomonResult.ruling?.result?.conditions?.join(", ") || "no conditions"}`);
      return { action: "continue" };
    }

    if (solomonResult.action === "pause") {
      return { action: "return", result: { paused: true, sessionId: session.id, question: solomonResult.question, context: "sonar_error" } };
    }

    // Solomon couldn't resolve — fail
    await markSessionStatus(session, "failed");
    throw new Error(errorMessage);
  }

  setSonarSummary(session, sonarOutput.summary);
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
      detail: { projectKey: sonarResult.projectKey, gateStatus: sonarResult.gateStatus, openIssues: sonarResult.openIssuesTotal, provider: "sonarqube", executorType: "local" }
    })
  );

  if (sonarResult.blocking) {
    return handleSonarBlocking({ sonarResult, config, logger, emitter, eventBase, session, iteration, repeatDetector, budgetSummary, askQuestion, task, brainCtx });
  }

  // Sonar passed — reset retry counter
  resetRetryCount(session, "sonar");
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
      message: "SonarCloud scanning",
      detail: { provider: "sonarcloud", executorType: "local" }
    })
  );

  const { runSonarCloudScan } = await import("../../sonar/cloud-scanner.js");
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
      detail: { projectKey: result.projectKey, exitCode: result.exitCode, provider: "sonarcloud", executorType: "local" }
    })
  );

  // SonarCloud is advisory — never blocks the pipeline
  return { action: "ok", stageResult: { ok: result.ok, projectKey: result.projectKey, message } };
}
