/**
 * Session flow control — checkpoints, timeouts, budget checks.
 * Extracted from orchestrator.js — session management, not orchestration.
 */
import { markSessionStatus, addCheckpoint } from "../session-store.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { msg, getLang } from "../utils/messages.js";

function detectCheckpointProgress(session, lastCheckpointSnapshot) {
  if (!lastCheckpointSnapshot) return true; // First checkpoint — assume progress
  const currentIteration = session.reviewer_retry_count ?? 0;
  const currentStages = Object.keys(session.resolved_policies || {}).length;
  const currentCheckpoints = (session.checkpoints || []).length;

  const iterationAdvanced = currentIteration !== lastCheckpointSnapshot.iteration;
  const stagesChanged = currentStages !== lastCheckpointSnapshot.stagesCount;
  const checkpointsChanged = currentCheckpoints !== lastCheckpointSnapshot.checkpointsCount;

  return iterationAdvanced || stagesChanged || checkpointsChanged;
}

export function takeCheckpointSnapshot(session) {
  return {
    iteration: session.reviewer_retry_count ?? 0,
    stagesCount: Object.keys(session.resolved_policies || {}).length,
    checkpointsCount: (session.checkpoints || []).length
  };
}

/**
 * Determine if checkpoint should auto-continue without asking the user.
 * Exported for testing.
 */
export function shouldAutoContinueCheckpoint(session, hasProgress) {
  if (hasProgress) {
    session._checkpoint_stall_count = 0;
    return { autoContinue: true, reason: "progress_detected" };
  }
  const wasRateLimited = (session.standby_retry_count || 0) > 0;
  const consecutiveStalls = (session._checkpoint_stall_count || 0) + 1;
  session._checkpoint_stall_count = consecutiveStalls;
  if (wasRateLimited && consecutiveStalls < 3) {
    return { autoContinue: true, reason: "recoverable_stall" };
  }
  return { autoContinue: false, reason: consecutiveStalls >= 3 ? "max_stalls_reached" : "no_progress" };
}

export async function handleCheckpoint({ checkpointDisabled, askQuestion, lastCheckpointAt, checkpointIntervalMs, elapsedMinutes, i, config, budgetTracker, stageResults, emitter, eventBase, session, budgetSummary, lastCheckpointSnapshot }) {
  if (checkpointDisabled || !askQuestion || (Date.now() - lastCheckpointAt) < checkpointIntervalMs) {
    return { action: "continue_loop", checkpointDisabled, lastCheckpointAt, lastCheckpointSnapshot };
  }

  const elapsedStr = elapsedMinutes.toFixed(1);
  const stagesCompleted = Object.keys(stageResults).join(", ") || "none";

  const hasProgress = detectCheckpointProgress(session, lastCheckpointSnapshot);
  const newSnapshot = takeCheckpointSnapshot(session);
  const decision = shouldAutoContinueCheckpoint(session, hasProgress);

  if (decision.autoContinue) {
    emitProgress(
      emitter,
      makeEvent("session:checkpoint", { ...eventBase, iteration: i, stage: "checkpoint" }, {
        message: `Checkpoint: ${decision.reason === "progress_detected" ? "progress detected" : "stall caused by rate limit/cooldown"}, auto-continuing (${elapsedStr} min elapsed)`,
        detail: { elapsed_minutes: Number(elapsedStr), iterations_done: i - 1, stages: stagesCompleted, auto_continued: true, reason: decision.reason }
      })
    );
    return { action: "continue_loop", checkpointDisabled, lastCheckpointAt: Date.now(), lastCheckpointSnapshot: newSnapshot };
  }

  const iterInfo = `${i - 1}/${config.max_iterations} iterations completed`;
  const budgetInfo = budgetTracker.total().cost_usd > 0 ? ` | Budget: $${budgetTracker.total().cost_usd.toFixed(2)}` : "";
  const checkpointMsg = `Checkpoint — ${elapsedStr} min elapsed | ${iterInfo}${budgetInfo} | Stages completed: ${stagesCompleted}. No progress since last checkpoint. What would you like to do?`;

  emitProgress(
    emitter,
    makeEvent("session:checkpoint", { ...eventBase, iteration: i, stage: "checkpoint" }, {
      message: `Interactive checkpoint at ${elapsedStr} min (stalled)`,
      detail: { elapsed_minutes: Number(elapsedStr), iterations_done: i - 1, stages: stagesCompleted, auto_continued: false }
    })
  );

  const lang = getLang(config);
  const answer = await askQuestion(
    `${checkpointMsg}\n\n${msg("checkpoint_options", lang)}`
  );

  await addCheckpoint(session, { stage: "interactive-checkpoint", elapsed_minutes: Number(elapsedStr), answer });

  const trimmedAnswer = (answer || "").trim();
  const isExplicitStop = trimmedAnswer === "4" || trimmedAnswer.toLowerCase().startsWith("stop");

  if (isExplicitStop) {
    await markSessionStatus(session, "stopped");
    emitProgress(
      emitter,
      makeEvent("session:end", { ...eventBase, iteration: i, stage: "user-stop" }, {
        status: "stopped",
        message: "Session stopped by user at checkpoint",
        detail: { approved: false, reason: "user_stopped", elapsed_minutes: Number(elapsedStr), budget: budgetSummary() }
      })
    );
    return { action: "stop", result: { approved: false, sessionId: session.id, reason: "user_stopped", elapsed_minutes: Number(elapsedStr) } };
  }

  const parsed = parseCheckpointAnswer({ trimmedAnswer, checkpointDisabled, config });
  parsed.lastCheckpointSnapshot = newSnapshot;
  return parsed;
}

export function parseCheckpointAnswer({ trimmedAnswer, checkpointDisabled, config }) {
  if (!trimmedAnswer) {
    return { action: "continue_loop", checkpointDisabled, lastCheckpointAt: Date.now() };
  }
  if (trimmedAnswer === "2" || trimmedAnswer.toLowerCase().startsWith("continue until")) {
    return { action: "continue_loop", checkpointDisabled: true, lastCheckpointAt: Date.now() };
  }
  if (trimmedAnswer === "1" || trimmedAnswer.toLowerCase().includes("5 m")) {
    return { action: "continue_loop", checkpointDisabled, lastCheckpointAt: Date.now() };
  }
  const customMinutes = Number.parseInt(trimmedAnswer.replaceAll(/\D/g, ""), 10);
  if (customMinutes > 0) {
    config.session.checkpoint_interval_minutes = customMinutes;
    return { action: "continue_loop", checkpointDisabled, lastCheckpointAt: Date.now() };
  }
  return { action: "continue_loop", checkpointDisabled, lastCheckpointAt: Date.now() };
}

export async function checkSessionTimeout({ askQuestion, elapsedMinutes, config, session, emitter, eventBase, i, budgetSummary }) {
  if (askQuestion || elapsedMinutes <= config.session.max_total_minutes) return;

  await markSessionStatus(session, "failed");
  emitProgress(
    emitter,
    makeEvent("session:end", { ...eventBase, iteration: i, stage: "timeout" }, {
      status: "fail",
      message: "Session timed out",
      detail: { approved: false, reason: "timeout", budget: budgetSummary() }
    })
  );
  throw new Error("Session timed out");
}

export async function checkBudgetExceeded({ budgetTracker, config, session, emitter, eventBase, i, budgetLimit, budgetSummary }) {
  if (!budgetTracker.isOverBudget(config?.max_budget_usd)) return;

  await markSessionStatus(session, "failed");
  const totalCost = budgetTracker.total().cost_usd;
  const message = `Budget exceeded: $${totalCost.toFixed(2)} > $${budgetLimit.toFixed(2)}`;
  emitProgress(
    emitter,
    makeEvent("session:end", { ...eventBase, iteration: i, stage: "budget" }, {
      status: "fail",
      message,
      detail: { approved: false, reason: "budget_exceeded", budget: budgetSummary(), max_budget_usd: budgetLimit }
    })
  );
  throw new Error(message);
}
