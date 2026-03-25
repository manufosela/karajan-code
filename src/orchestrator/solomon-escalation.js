import { SolomonRole } from "../roles/solomon-role.js";
import { addCheckpoint, pauseSession } from "../session-store.js";
import { emitProgress, makeEvent } from "../utils/events.js";

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
  const reason = conflict?.solomonReason || `${stage} conflict unresolved`;
  const question = `${stage} conflict requires human intervention: ${reason}\nDetails: ${JSON.stringify(conflict?.history?.slice(-2) || [], null, 2)}\n\nHow should we proceed?`;

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
