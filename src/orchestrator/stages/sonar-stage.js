/**
 * Sonar stage logic + sonar retry logic.
 * Extracted from iteration-stages.js for maintainability.
 */

import { SonarRole } from "../../roles/sonar-role.js";
import { addCheckpoint, markSessionStatus, saveSession } from "../../session-store.js";
import { emitProgress, makeEvent } from "../../utils/events.js";
import { invokeSolomon } from "../solomon-escalation.js";
import { sonarUp, isSonarReachable } from "../../sonar/manager.js";

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

  if (solomonResult.action === "pause") {
    return { action: "pause", result: { paused: true, sessionId: session.id, question: solomonResult.question, context: "sonar_fail_fast" } };
  }
  if (solomonResult.action === "subtask") {
    return { action: "pause", result: { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "sonar_subtask" } };
  }
  if (solomonResult.action === "continue") {
    if (solomonResult.humanGuidance) {
      session.last_reviewer_feedback += `\nUser guidance: ${solomonResult.humanGuidance}`;
    }
    session.sonar_retry_count = 0;
    await saveSession(session);
    return { action: "continue" };
  }

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

    // Let Solomon decide: continue without sonar or stop
    const solomonResult = await invokeSolomon({
      config, logger, emitter, eventBase, stage: "sonar_error", askQuestion, session, iteration,
      conflict: {
        stage: "sonar_error",
        task: session.task,
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
      detail: { projectKey: sonarResult.projectKey, gateStatus: sonarResult.gateStatus, openIssues: sonarResult.openIssuesTotal, provider: "sonarqube", executorType: "local" }
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
