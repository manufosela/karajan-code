/**
 * Pipeline event helpers.
 * Extracted from orchestrator.js for reuse across modules.
 */

export function emitProgress(emitter, data) {
  if (!emitter) return;
  emitter.emit("progress", data);
}

export function makeEvent(type, base, extra = {}) {
  return {
    type,
    sessionId: base.sessionId,
    iteration: base.iteration,
    stage: base.stage,
    status: extra.status || "ok",
    message: extra.message || type,
    detail: extra.detail || {},
    elapsed: base.startedAt ? Date.now() - base.startedAt : 0,
    timestamp: new Date().toISOString()
  };
}

/**
 * Standard agent output emitter. Routes tool invocations to agent:action
 * (visible in quiet mode) and everything else to agent:output (verbose only).
 */
export function emitAgentOutput(emitter, eventBase, stage, provider, { stream, line, kind }) {
  const eventType = kind === "tool" ? "agent:action" : "agent:output";
  emitProgress(emitter, makeEvent(eventType, { ...eventBase, stage }, {
    message: line,
    detail: { stream, agent: provider, kind }
  }));
}
