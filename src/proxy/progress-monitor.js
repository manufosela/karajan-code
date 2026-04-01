/**
 * Progress monitor that bridges the response interceptor's events
 * to KJ's structured progress event system.
 *
 * Subscribes to interceptorEmitter events (tool_call, usage, message_complete)
 * and re-emits structured, timestamped progress events on the main emitter.
 *
 * @module proxy/progress-monitor
 */

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen) {
  if (typeof str !== "string") return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

/**
 * Create a progress monitor that subscribes to interceptor events
 * and re-emits structured progress events on the main emitter.
 *
 * @param {object} config
 * @param {import("node:events").EventEmitter} config.emitter - Main event emitter to emit structured events on
 * @param {import("node:events").EventEmitter} config.interceptorEmitter - Interceptor emitter to subscribe to
 * @param {string} config.stage - Pipeline stage name (e.g. "coder", "reviewer")
 * @param {string} config.provider - AI provider name (e.g. "anthropic", "openai")
 * @returns {{ getStats: () => object, stop: () => void }}
 */
export function createProgressMonitor({
  emitter,
  interceptorEmitter,
  stage,
  provider,
}) {
  const stats = {
    toolCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };

  function onToolCall({ name, id }) {
    stats.toolCalls++;
    const input = id ? truncate(String(id), 100) : "";
    emitter.emit("progress", {
      type: "proxy:tool_call",
      stage,
      provider,
      tool: name,
      input,
      timestamp: Date.now(),
    });
  }

  function onUsage({ input_tokens, output_tokens }) {
    const inputTokens = input_tokens || 0;
    const outputTokens = output_tokens || 0;
    stats.totalInputTokens += inputTokens;
    stats.totalOutputTokens += outputTokens;
    emitter.emit("progress", {
      type: "proxy:usage",
      stage,
      provider,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      timestamp: Date.now(),
    });
  }

  function onMessageComplete() {
    emitter.emit("progress", {
      type: "proxy:message_complete",
      stage,
      provider,
      timestamp: Date.now(),
    });
  }

  interceptorEmitter.on("tool_call", onToolCall);
  interceptorEmitter.on("usage", onUsage);
  interceptorEmitter.on("message_complete", onMessageComplete);

  function getStats() {
    return { ...stats };
  }

  function stop() {
    interceptorEmitter.off("tool_call", onToolCall);
    interceptorEmitter.off("usage", onUsage);
    interceptorEmitter.off("message_complete", onMessageComplete);
  }

  return { getStats, stop };
}
