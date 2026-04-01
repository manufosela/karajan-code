/**
 * OpenAI message format adapter.
 *
 * OpenAI Chat Completions API uses messages with `role: "tool"`.
 * Each tool message has a `tool_call_id` linking back to the assistant's
 * `tool_calls` array, and a `content` string with the tool output.
 *
 * @module
 */

/**
 * Extract tool results from OpenAI-format messages.
 *
 * @param {Array<object>} messages - OpenAI messages array
 * @returns {Array<{id: string, toolName: string, text: string, turnIndex: number}>}
 */
export function extractToolResults(messages) {
  const results = [];
  const toolNameMap = buildToolNameMap(messages);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== "tool") continue;

    const id = msg.tool_call_id || "";
    const text = typeof msg.content === "string" ? msg.content : "";
    const toolName = toolNameMap.get(id) || "unknown";

    results.push({ id, toolName, text, turnIndex: i });
  }

  return results;
}

/**
 * Rebuild messages replacing tool message content with compressed versions.
 *
 * @param {Array<object>} messages - Original OpenAI messages array
 * @param {Map<string, string>|Record<string, string>} compressedMap - id → compressed text
 * @returns {Array<object>} Deep-cloned messages with replacements applied
 */
export function rebuildMessages(messages, compressedMap) {
  const map = compressedMap instanceof Map ? compressedMap : new Map(Object.entries(compressedMap));
  return messages.map((msg) => {
    if (!msg || msg.role !== "tool") return msg;

    const id = msg.tool_call_id || "";
    if (!map.has(id)) return msg;

    return { ...msg, content: map.get(id) };
  });
}

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Build a map of tool_call id → function name by scanning assistant messages.
 * Assistant messages contain `tool_calls: [{id, function: {name, arguments}}]`.
 */
function buildToolNameMap(messages) {
  const map = new Map();
  for (const msg of messages) {
    if (!msg || msg.role !== "assistant" || !Array.isArray(msg.tool_calls)) continue;
    for (const call of msg.tool_calls) {
      if (call.id && call.function) {
        map.set(call.id, call.function.name || "unknown");
      }
    }
  }
  return map;
}
