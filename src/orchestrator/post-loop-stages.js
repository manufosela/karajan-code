import { TesterRole } from "../roles/tester-role.js";
import { SecurityRole } from "../roles/security-role.js";
import { ImpeccableRole } from "../roles/impeccable-role.js";
import { addCheckpoint, saveSession } from "../session-store.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { invokeSolomon } from "./solomon-escalation.js";

export async function runTesterStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, iteration, task, diff, askQuestion }) {
  logger.setContext({ iteration, stage: "tester" });
  emitProgress(
    emitter,
    makeEvent("tester:start", { ...eventBase, stage: "tester" }, {
      message: "Tester evaluating test quality"
    })
  );

  const tester = new TesterRole({ config, logger, emitter });
  await tester.init({ task, iteration });
  const testerStart = Date.now();
  let testerOutput;
  try {
    testerOutput = await tester.run({ task, diff });
  } catch (err) {
    logger.warn(`Tester threw: ${err.message}`);
    testerOutput = { ok: false, summary: `Tester error: ${err.message}`, result: { error: err.message } };
  }
  trackBudget({
    role: "tester",
    provider: config?.roles?.tester?.provider || coderRole.provider,
    model: config?.roles?.tester?.model || coderRole.model,
    result: testerOutput,
    duration_ms: Date.now() - testerStart
  });

  await addCheckpoint(session, {
    stage: "tester",
    iteration,
    ok: testerOutput.ok,
    provider: config?.roles?.tester?.provider || coderRole.provider,
    model: config?.roles?.tester?.model || coderRole.model || null
  });

  emitProgress(
    emitter,
    makeEvent("tester:end", { ...eventBase, stage: "tester" }, {
      status: testerOutput.ok ? "ok" : "fail",
      message: testerOutput.ok ? "Tester passed" : `Tester: ${testerOutput.summary}`
    })
  );

  if (!testerOutput.ok) {
    const maxTesterRetries = config.session?.max_tester_retries ?? 1;
    session.tester_retry_count = (session.tester_retry_count || 0) + 1;
    await saveSession(session);

    if (session.tester_retry_count >= maxTesterRetries) {
      const solomonResult = await invokeSolomon({
        config, logger, emitter, eventBase, stage: "tester", askQuestion, session, iteration,
        conflict: {
          stage: "tester",
          task,
          diff,
          iterationCount: session.tester_retry_count,
          maxIterations: maxTesterRetries,
          history: [{ agent: "tester", feedback: testerOutput.summary }]
        }
      });

      if (solomonResult.action === "pause") {
        return { action: "pause", result: { paused: true, sessionId: session.id, question: solomonResult.question, context: "tester_fail_fast" } };
      }
      if (solomonResult.action === "subtask") {
        return { action: "pause", result: { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "tester_subtask" } };
      }
      // Solomon approved — proceed to next stage
      return { action: "ok" };
    }

    session.last_reviewer_feedback = `Tester feedback: ${testerOutput.summary}`;
    await saveSession(session);
    return { action: "continue" };
  }

  session.tester_retry_count = 0;
  return { action: "ok", stageResult: { ok: true, summary: testerOutput.summary || "All tests passed" } };
}

export async function runSecurityStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, iteration, task, diff, askQuestion }) {
  logger.setContext({ iteration, stage: "security" });
  emitProgress(
    emitter,
    makeEvent("security:start", { ...eventBase, stage: "security" }, {
      message: "Security auditing code"
    })
  );

  const security = new SecurityRole({ config, logger, emitter });
  await security.init({ task, iteration });
  const securityStart = Date.now();
  let securityOutput;
  try {
    securityOutput = await security.run({ task, diff });
  } catch (err) {
    logger.warn(`Security threw: ${err.message}`);
    securityOutput = { ok: false, summary: `Security error: ${err.message}`, result: { error: err.message } };
  }
  trackBudget({
    role: "security",
    provider: config?.roles?.security?.provider || coderRole.provider,
    model: config?.roles?.security?.model || coderRole.model,
    result: securityOutput,
    duration_ms: Date.now() - securityStart
  });

  await addCheckpoint(session, {
    stage: "security",
    iteration,
    ok: securityOutput.ok,
    provider: config?.roles?.security?.provider || coderRole.provider,
    model: config?.roles?.security?.model || coderRole.model || null
  });

  emitProgress(
    emitter,
    makeEvent("security:end", { ...eventBase, stage: "security" }, {
      status: securityOutput.ok ? "ok" : "fail",
      message: securityOutput.ok ? "Security audit passed" : `Security: ${securityOutput.summary}`
    })
  );

  if (!securityOutput.ok) {
    const maxSecurityRetries = config.session?.max_security_retries ?? 1;
    session.security_retry_count = (session.security_retry_count || 0) + 1;
    await saveSession(session);

    if (session.security_retry_count >= maxSecurityRetries) {
      const solomonResult = await invokeSolomon({
        config, logger, emitter, eventBase, stage: "security", askQuestion, session, iteration,
        conflict: {
          stage: "security",
          task,
          diff,
          iterationCount: session.security_retry_count,
          maxIterations: maxSecurityRetries,
          history: [{ agent: "security", feedback: securityOutput.summary }]
        }
      });

      if (solomonResult.action === "pause") {
        return { action: "pause", result: { paused: true, sessionId: session.id, question: solomonResult.question, context: "security_fail_fast" } };
      }
      if (solomonResult.action === "subtask") {
        return { action: "pause", result: { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "security_subtask" } };
      }
      // Solomon approved — proceed
      return { action: "ok" };
    }

    session.last_reviewer_feedback = `Security feedback: ${securityOutput.summary}`;
    await saveSession(session);
    return { action: "continue" };
  }

  session.security_retry_count = 0;
  return { action: "ok", stageResult: { ok: true, summary: securityOutput.summary || "No vulnerabilities found" } };
}

export async function runImpeccableStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, iteration, task, diff }) {
  logger.setContext({ iteration, stage: "impeccable" });
  emitProgress(
    emitter,
    makeEvent("impeccable:start", { ...eventBase, stage: "impeccable" }, {
      message: "Impeccable auditing frontend design quality"
    })
  );

  const impeccable = new ImpeccableRole({ config, logger, emitter });
  await impeccable.init({ task, iteration });
  const impeccableStart = Date.now();
  let impeccableOutput;
  try {
    impeccableOutput = await impeccable.run({ task, diff });
  } catch (err) {
    logger.warn(`Impeccable threw: ${err.message}`);
    impeccableOutput = { ok: false, summary: `Impeccable error: ${err.message}`, result: { error: err.message } };
  }
  trackBudget({
    role: "impeccable",
    provider: config?.roles?.impeccable?.provider || coderRole.provider,
    model: config?.roles?.impeccable?.model || coderRole.model,
    result: impeccableOutput,
    duration_ms: Date.now() - impeccableStart
  });

  await addCheckpoint(session, {
    stage: "impeccable",
    iteration,
    ok: impeccableOutput.ok,
    provider: config?.roles?.impeccable?.provider || coderRole.provider,
    model: config?.roles?.impeccable?.model || coderRole.model || null
  });

  const verdict = impeccableOutput.result?.verdict || "APPROVED";
  emitProgress(
    emitter,
    makeEvent("impeccable:end", { ...eventBase, stage: "impeccable" }, {
      status: impeccableOutput.ok ? "ok" : "fail",
      message: impeccableOutput.ok
        ? (verdict === "IMPROVED" ? "Impeccable applied design fixes" : "Impeccable audit passed")
        : `Impeccable: ${impeccableOutput.summary}`
    })
  );

  // Impeccable is advisory — failures do not block the pipeline
  return { action: "ok", stageResult: { ok: impeccableOutput.ok, verdict, summary: impeccableOutput.summary || "No frontend design issues found" } };
}
