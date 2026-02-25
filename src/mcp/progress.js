/**
 * MCP progress notification helpers.
 * Extracted from server.js for testability and reuse.
 */

export const PROGRESS_STAGES = [
  "session:start",
  "iteration:start",
  "planner:start",
  "planner:end",
  "coder:start",
  "coder:end",
  "refactorer:start",
  "refactorer:end",
  "tdd:result",
  "sonar:start",
  "sonar:end",
  "reviewer:start",
  "reviewer:end",
  "iteration:end",
  "solomon:escalate",
  "question",
  "session:end",
  "dry-run:summary"
];

export function buildProgressHandler(server) {
  return (event) => {
    try {
      server.sendLoggingMessage({
        level: event.type === "agent:output" ? "debug" : event.status === "fail" ? "error" : "info",
        logger: "karajan",
        data: event
      });
    } catch {
      // best-effort: if logging fails, continue
    }
  };
}

export function buildProgressNotifier(extra) {
  const progressToken = extra?._meta?.progressToken;
  if (progressToken === undefined) return null;

  const total = PROGRESS_STAGES.length;
  return (event) => {
    const idx = PROGRESS_STAGES.indexOf(event.type);
    if (idx < 0) return;

    const iteration = event.iteration || event.detail?.iteration;
    const message = iteration
      ? `[${event.iteration}] ${event.message || event.type}`
      : event.message || event.type;

    try {
      extra.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: idx + 1,
          total,
          message
        }
      });
    } catch {
      // best-effort
    }
  };
}
