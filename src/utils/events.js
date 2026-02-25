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
