/**
 * Error-recovery driver — extracted from src/orchestrator/flow-runner.js
 * in TSK-0335 (Oleada 3 of the v2.7.4 audit refactor).
 *
 * Five handlers that react to pipeline-level failure signals and decide
 * whether to retry, pause, or escalate to Solomon:
 *
 *   - handleStandbyResult:            rate-limit / provider-outage →
 *                                     Solomon decides skip/retry/wait/pause.
 *   - emitSolomonAlerts:              forward Solomon-rules findings to
 *                                     the progress stream.
 *   - handleSolomonCheck:             evaluate Solomon-rules context,
 *                                     escalate critical alerts (direct to
 *                                     human without Brain, via Solomon
 *                                     with Brain).
 *   - checkSolomonCriticalAlerts:     non-Brain branch — ask the user
 *                                     whether to continue/pause/stop on
 *                                     critical alerts.
 *   - handleReviewerRetryAndSolomon:  reviewer sub-loop limit → invoke
 *                                     Solomon to resolve the stall.
 *
 * These were extracted verbatim; no behavior change. flow-runner.js now
 * imports them instead of defining them. Part of breaking up the 2254-LOC
 * god-module — see docs/ARCHITECTURE.md and the TSK-0335 acceptance
 * criteria.
 */

import { invokeSolomon } from "../solomon-escalation.js";
import { saveSession, pauseSession } from "../../session/store.js";
import {
  setReviewerFeedback, setAlternativeAgent, resetRetryCount,
  incrementRetryCount,
} from "../../session/mutators.js";
import { emitProgress, makeEvent } from "../../utils/events.js";
import { tryCiComment } from "../ci-integration.js";

export async function handleStandbyResult({ stageResult, session, emitter, eventBase, i, stage, logger, config, askQuestion }) {
  if (stageResult?.action !== "standby") {
    return { handled: false };
  }

  const isOutage = stageResult.standbyInfo.isProviderOutage;
  const agent = stageResult.standbyInfo.agent;
  const cooldownUntil = stageResult.standbyInfo.cooldownUntil;
  const cooldownMs = stageResult.standbyInfo.cooldownMs;

  // Rate limit = out of normal flow → Solomon decides immediately
  const solomonResult = await invokeSolomon({
    config, logger, emitter, eventBase, stage: `${stage}_rate_limit`, askQuestion, session,
    iteration: i,
    conflict: {
      stage: `${stage}_rate_limit`,
      task: session.task,
      iterationCount: i,
      maxIterations: config?.max_iterations || 5,
      cooldownUntil,
      cooldownMs,
      history: [{
        agent: stage,
        feedback: `Agent "${agent}" rate-limited. ${isOutage ? "Provider outage (5xx)." : "API rate limit (429)."} ${cooldownUntil ? `Cooldown until ${cooldownUntil}.` : ""}`
      }]
    }
  });

  if (solomonResult.action === "approve") {
    // Solomon says skip is safe — only allowed after exhausting alternatives
    logger.info(`Solomon: skip ${stage} after evaluating risk (agent "${agent}" rate-limited)`);
    emitProgress(emitter, makeEvent(`${stage}:rate_limit`, { ...eventBase, stage }, {
      status: "ok",
      message: `Solomon: skip ${stage} (low risk, agent "${agent}" unavailable)`,
      detail: { agent, solomonAction: "approve" }
    }));
    return { handled: true, action: "skip" };
  }

  if (solomonResult.action === "continue") {
    // Solomon says: wait for cooldown, or retry with alternative agent
    const altAgent = solomonResult.alternativeAgent;
    const waitTarget = solomonResult.waitUntil;

    if (waitTarget) {
      const waitMs = Math.max(0, new Date(waitTarget).getTime() - Date.now());
      if (waitMs > 0 && waitMs < 10 * 60 * 1000) {
        logger.info(`Solomon: wait ${Math.round(waitMs / 1000)}s for cooldown, then retry ${stage}`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }

    if (altAgent) {
      logger.info(`Solomon: retry ${stage} with alternative agent "${altAgent}"`);
      setAlternativeAgent(session, stage, altAgent);
    }

    if (solomonResult.humanGuidance) {
      setReviewerFeedback(session, `Solomon guidance: ${solomonResult.humanGuidance}`);
    }
    await saveSession(session);
    return { handled: true, action: "retry_reviewer_only" };
  }

  if (solomonResult.action === "pause") {
    return {
      handled: true,
      action: "return",
      result: { paused: true, sessionId: session.id, question: solomonResult.question, context: "rate_limit" }
    };
  }

  // Solomon couldn't resolve — pause
  await pauseSession(session, {
    question: `Agent "${agent}" rate-limited. Solomon could not resolve.`,
    context: { iteration: i, stage, reason: "rate_limit" }
  });
  return {
    handled: true,
    action: "return",
    result: { paused: true, sessionId: session.id, question: `Agent "${agent}" rate-limited`, context: "rate_limit" }
  };
}


function emitSolomonAlerts(alerts, emitter, eventBase, logger) {
  for (const alert of alerts) {
    emitProgress(emitter, makeEvent("brain:rules-alert", { ...eventBase, stage: "brain" }, {
      status: alert.severity === "critical" ? "fail" : "warn",
      message: alert.message,
      detail: alert.detail
    }));
    logger.warn(`Rules alert [${alert.rule}]: ${alert.message}`);
  }
}

export async function handleSolomonCheck({ config, session, emitter, eventBase, logger, task, i, askQuestion, ciEnabled, blockingIssues, brainCtx }) {
  if (config.pipeline?.solomon?.enabled === false) return { action: "continue" };

  try {
    const { evaluateRules, buildRulesContext } = await import("../solomon-rules.js");
    const rulesContext = await buildRulesContext({ session, task, iteration: i, blockingIssues });
    const rulesResult = evaluateRules(rulesContext, config.solomon?.rules);

    if (rulesResult.alerts.length > 0) {
      emitSolomonAlerts(rulesResult.alerts, emitter, eventBase, logger);
      // Brain gateway: when Brain is the orchestrator, rule alerts are telemetry.
      // On critical alerts Brain consults Solomon (AI judge). Only if Solomon can't
      // resolve does Brain escalate to human. Solomon-rules never prompts directly.
      if (!brainCtx?.enabled) {
        const pauseResult = await checkSolomonCriticalAlerts({ rulesResult, askQuestion, session, i });
        if (pauseResult) return pauseResult;
      } else if (rulesResult.hasCritical) {
        const criticalAlerts = rulesResult.alerts.filter(a => a.severity === "critical");
        brainCtx.ruleAlerts = brainCtx.ruleAlerts || [];
        brainCtx.ruleAlerts.push(...criticalAlerts);
        logger.info(`Brain: ${criticalAlerts.length} critical rule alert(s) — consulting Solomon`);

        const alertSummary = criticalAlerts.map(a => a.message).join("; ");
        const solomonOpinion = await invokeSolomon({
          config, logger, emitter, eventBase, stage: "brain-dilemma", askQuestion, session, iteration: i,
          conflict: {
            stage: "brain-dilemma",
            task,
            iterationCount: i,
            maxIterations: config.max_iterations,
            dilemma: `Brain detected critical rule alerts: ${alertSummary}. Should we continue iterating, pause for human, or stop?`,
            ruleAlerts: criticalAlerts,
            blockingIssues: blockingIssues || [],
            history: (session.checkpoints || []).filter(cp => cp.stage === "reviewer").slice(-5).map(cp => ({ iteration: cp.iteration, feedback: cp.note || "" }))
          }
        });

        if (solomonOpinion.action === "pause") {
          logger.info("Brain: Solomon advised pause — escalating to human");
          return { action: "return", result: { paused: true, sessionId: session.id, question: solomonOpinion.question || `Brain+Solomon paused: ${alertSummary}`, context: "brain_solomon_dilemma" } };
        }
        if (solomonOpinion.action === "approve") {
          logger.info("Brain: Solomon advised proceeding — treating as approved");
          return { action: "continue", approved: true };
        }
        // action === "continue" | "subtask" | fallback → Brain continues the loop
        logger.info(`Brain: Solomon said '${solomonOpinion.action}' — continuing loop`);
      }
    }

    if (ciEnabled && session.ci_pr_number) {
      const alerts = rulesResult.alerts || [];
      const alertMsg = alerts.length > 0
        ? alerts.map(a => `- [${a.severity}] ${a.message}`).join("\n")
        : "No anomalies detected";
      await tryCiComment({
        config, session, logger,
        agent: "Solomon",
        body: `Supervisor check iteration ${i}: ${alertMsg}`
      });
    }
  } catch (err) {
    logger.warn(`Solomon rules evaluation failed: ${err.message}`);
  }

  return { action: "continue" };
}

async function checkSolomonCriticalAlerts({ rulesResult, askQuestion, session, i }) {
  if (!rulesResult.hasCritical || !askQuestion) return null;

  const alertSummary = rulesResult.alerts
    .filter(a => a.severity === "critical")
    .map(a => a.message)
    .join("\n");
  const question = [
    "Solomon detected critical issues:",
    alertSummary,
    "",
    "What should we do?",
    "1 = Continue anyway",
    "2 = Pause the session",
    "3 = Stop the session",
    "",
    "Type 1, 2, or 3:"
  ].join("\n");
  const answer = await askQuestion(question, { iteration: i, stage: "solomon" });
  const trimmed = (answer || "").trim().toLowerCase();
  const shouldPause = !answer
    || trimmed === "2" || trimmed === "3"
    || trimmed.startsWith("pause") || trimmed.startsWith("stop");
  if (shouldPause) {
    await pauseSession(session, {
      question: `Solomon supervisor paused: ${alertSummary}`,
      context: { iteration: i, stage: "solomon", alerts: rulesResult.alerts }
    });
    return { action: "pause", result: { paused: true, sessionId: session.id, reason: "solomon_alert" } };
  }
  return null;
}

export async function handleReviewerRetryAndSolomon({ config, session, emitter, eventBase, logger, review, task, i, askQuestion }) {
  setReviewerFeedback(session, review.blocking_issues
    .map((x) => {
      const parts = [`[${x.severity || "high"}] ${x.id || "ISSUE"}: ${x.description || "Missing description"}`];
      if (x.file) parts.push(`  File: ${x.file}${x.line ? `:${x.line}` : ""}`);
      if (x.suggested_fix) parts.push(`  Fix: ${x.suggested_fix}`);
      return parts.join("\n");
    })
    .join("\n\n"));
  incrementRetryCount(session, "reviewer");
  await saveSession(session);

  const maxReviewerRetries = config.session.max_reviewer_retries ?? config.session.fail_fast_repeats;
  if (session.reviewer_retry_count < maxReviewerRetries) {
    return { action: "continue" };
  }

  emitProgress(
    emitter,
    makeEvent("solomon:escalate", { ...eventBase, stage: "reviewer" }, {
      message: `Reviewer sub-loop limit reached (${session.reviewer_retry_count}/${maxReviewerRetries})`,
      detail: { subloop: "reviewer", retryCount: session.reviewer_retry_count, limit: maxReviewerRetries }
    })
  );

  const solomonResult = await invokeSolomon({
    config, logger, emitter, eventBase, stage: "reviewer", askQuestion, session, iteration: i,
    conflict: {
      stage: "reviewer",
      task,
      iterationCount: session.reviewer_retry_count,
      maxIterations: maxReviewerRetries,
      history: [{ agent: "reviewer", feedback: session.last_reviewer_feedback }]
    }
  });

  if (solomonResult.action === "pause") {
    return { action: "return", result: { paused: true, sessionId: session.id, question: solomonResult.question, context: "reviewer_fail_fast" } };
  }
  if (solomonResult.action === "continue") {
    if (solomonResult.humanGuidance) {
      // Append, not overwrite — keep the reviewer's blocking issues context.
      setReviewerFeedback(session, `${session.last_reviewer_feedback}\nUser guidance: ${solomonResult.humanGuidance}`);
    }
    resetRetryCount(session, "reviewer");
    await saveSession(session);
    return { action: "continue" };
  }
  if (solomonResult.action === "subtask") {
    return { action: "return", result: { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "reviewer_subtask" } };
  }

  return { action: "continue" };
}
