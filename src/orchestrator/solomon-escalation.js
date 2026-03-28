import { SolomonRole } from "../roles/solomon-role.js";
import { addCheckpoint, pauseSession } from "../session-store.js";
import { emitProgress, makeEvent } from "../utils/events.js";

/**
 * Build a human-readable escalation message from raw Solomon conflict data.
 * Replaces the raw JSON dump with structured, plain-text output.
 *
 * @param {object} solomonResult - The conflict object passed to escalateToHuman
 * @param {object} [session]     - Current session (optional, used for extra context)
 * @returns {string} Formatted message suitable for display to the user
 */
export function formatEscalationMessage(solomonResult, session) {
  const stage = solomonResult?.stage || "unknown";
  const solomonReason = solomonResult?.solomonReason || null;
  const history = solomonResult?.history || [];

  const lines = [];
  lines.push(`--- Conflict: ${stage} ---`);
  lines.push("");

  // Extract reviewer/agent feedback from history
  const feedbackEntries = history.filter(entry => entry && typeof entry === "object");
  if (feedbackEntries.length > 0) {
    lines.push("Reviewer feedback:");
    for (const entry of feedbackEntries) {
      const agent = entry.agent || "unknown";
      const feedback = entry.feedback || "No feedback provided";
      // Split multi-line feedback (e.g. "R-1: ...\nR-2: ...") into bullet points
      const feedbackLines = String(feedback).split("\n").filter(l => l.trim());
      if (feedbackLines.length === 1) {
        lines.push(`  [${agent}] ${feedbackLines[0]}`);
      } else {
        lines.push(`  [${agent}]`);
        for (const fl of feedbackLines) {
          lines.push(`    - ${fl}`);
        }
      }
    }
    lines.push("");
  }

  // Solomon's reason (if it tried and failed)
  if (solomonReason) {
    lines.push(`Solomon could not resolve the conflict: ${solomonReason}`);
    lines.push("");
  }

  // Iteration context
  const iterationCount = solomonResult?.iterationCount;
  const maxIterations = solomonResult?.maxIterations;
  if (iterationCount !== undefined && maxIterations !== undefined) {
    lines.push(`Iterations: ${iterationCount}/${maxIterations}`);
    lines.push("");
  }

  lines.push("Options:");
  lines.push("  1. Accept coder's work as-is");
  lines.push("  2. Retry with reviewer's feedback");
  lines.push("  3. Stop the session");
  lines.push("");
  lines.push("How should we proceed?");

  return lines.join("\n");
}

export async function invokeSolomon({ config, logger, emitter, eventBase, stage, conflict, askQuestion, session, iteration }) {
  const solomonEnabled = Boolean(config.pipeline?.solomon?.enabled);

  if (!solomonEnabled) {
    return escalateToHuman({ askQuestion, session, emitter, eventBase, stage, conflict, iteration });
  }

  const solomonProvider = config?.roles?.solomon?.provider || "gemini";
  emitProgress(
    emitter,
    makeEvent("solomon:start", { ...eventBase, stage: "solomon" }, {
      message: `Solomon arbitrating ${stage} conflict`,
      detail: { conflictStage: stage, provider: solomonProvider, executorType: "agent" }
    })
  );

  const solomon = new SolomonRole({ config, logger, emitter });
  await solomon.init({ task: conflict.task || session.task, iteration });
  let ruling;
  try {
    ruling = await solomon.run({ conflict });
  } catch (err) {
    logger.warn(`Solomon threw: ${err.message}`);
    return escalateToHuman({
      askQuestion, session, emitter, eventBase, stage, iteration,
      conflict: { ...conflict, solomonReason: `Solomon error: ${err.message}` }
    });
  }

  const solomonError = ruling.result?.error;
  if (!ruling.ok && solomonError) {
    logger.warn(`Solomon execution failed: ${solomonError}`);
  }

  emitProgress(
    emitter,
    makeEvent("solomon:end", { ...eventBase, stage: "solomon" }, {
      message: ruling.ok
        ? `Solomon ruling: ${ruling.result?.ruling || "unknown"}`
        : `Solomon failed: ${(solomonError || ruling.summary || "unknown error").slice(0, 200)}`,
      detail: { ...ruling.result, provider: solomonProvider, executorType: "agent" }
    })
  );

  await addCheckpoint(session, {
    stage: "solomon",
    iteration,
    ruling: ruling.result?.ruling,
    escalate: ruling.result?.escalate,
    error: solomonError ? solomonError.slice(0, 500) : undefined,
    subtask: ruling.result?.subtask?.title || null
  });

  if (!ruling.ok) {
    const reason = ruling.result?.escalate_reason || solomonError || ruling.summary;
    return escalateToHuman({
      askQuestion, session, emitter, eventBase, stage, iteration,
      conflict: { ...conflict, solomonReason: reason }
    });
  }

  const r = ruling.result?.ruling;
  if (r === "approve") {
    return { action: "approve", conditions: [], ruling };
  }
  if (r === "approve_with_conditions") {
    return { action: "continue", conditions: ruling.result?.conditions || [], ruling };
  }

  if (r === "escalate_human") {
    return escalateToHuman({
      askQuestion, session, emitter, eventBase, stage, iteration,
      conflict: { ...conflict, solomonReason: ruling.result?.escalate_reason || "Solomon escalated to human" }
    });
  }

  if (r === "create_subtask") {
    return { action: "subtask", subtask: ruling.result?.subtask, ruling };
  }

  return { action: "continue", conditions: [], ruling };
}

export async function escalateToHuman({ askQuestion, session, emitter, eventBase, stage, conflict, iteration }) {
  const question = formatEscalationMessage({ ...conflict, stage }, session);

  if (askQuestion) {
    const answer = await askQuestion(question, { iteration, stage });
    if (answer) {
      return { action: "continue", humanGuidance: answer };
    }
  }

  await pauseSession(session, {
    question,
    context: { iteration, stage, conflict }
  });
  emitProgress(
    emitter,
    makeEvent("question", { ...eventBase, stage }, {
      status: "paused",
      message: question,
      detail: { question, sessionId: session.id }
    })
  );

  return { action: "pause", question };
}
