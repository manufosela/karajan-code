/**
 * Anthropic message format adapter.
 *
 * Anthropic messages API uses an array of messages where each message has a
 * `content` array. Tool results appear as content blocks with
 * `type: "tool_result"`. Each tool_result block contains an `id` (matching
 * the prior tool_use), optional `tool_use_id`, and nested `content` that
 * can be a string or an array of content blocks (text, image, etc.).
 *
 * @module
 */

/**
 * Extract tool results from Anthropic-format messages.
 *
 * @param {Array<object>} messages - Anthropic messages array
 * @returns {Array<{id: string, toolName: string, text: string, turnIndex: number}>}
 */
export function extractToolResults(messages) {
  const results = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || !Array.isArray(msg.content)) continue;

    // Collect tool_use names from assistant messages so we can map ids to names
    const toolNameMap = buildToolNameMap(messages, i);

    for (const block of msg.content) {
      if (block.type !== "tool_result") continue;

      const id = block.tool_use_id || block.id || "";
      const text = extractText(block);
      const toolName = toolNameMap.get(id) || "unknown";

      results.push({ id, toolName, text, turnIndex: i });
    }
  }

  return results;
}

/**
 * Rebuild messages replacing tool_result text with compressed versions.
 *
 * @param {Array<object>} messages - Original Anthropic messages array
 * @param {Map<string, string>|Record<string, string>} compressedMap - id → compressed text
 * @returns {Array<object>} Deep-cloned messages with replacements applied
 */
export function rebuildMessages(messages, compressedMap) {
  const map = compressedMap instanceof Map ? compressedMap : new Map(Object.entries(compressedMap));
  return messages.map((msg) => {
    if (!msg || !Array.isArray(msg.content)) return msg;

    const newContent = msg.content.map((block) => {
      if (block.type !== "tool_result") return block;

      const id = block.tool_use_id || block.id || "";
      if (!map.has(id)) return block;

      const compressed = map.get(id);
      return replaceText(block, compressed);
    });

    return { ...msg, content: newContent };
  });
}

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Build a map of tool_use id → tool name by scanning assistant messages
 * that precede or are at the given turn index.
 */
function buildToolNameMap(messages, upToIndex) {
  const map = new Map();
  for (let i = 0; i <= upToIndex; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.id) {
        map.set(block.id, block.name || "unknown");
      }
    }
  }
  return map;
}

/**
 * Extract plain text from a tool_result block.
 * Content can be a string, an array of {type:"text", text} blocks, or absent.
 */
function extractText(block) {
  if (typeof block.content === "string") return block.content;
  if (Array.isArray(block.content)) {
    return block.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

/**
 * Return a new tool_result block with text replaced.
 * Preserves the content shape (string vs array).
 */
function replaceText(block, newText) {
  if (typeof block.content === "string") {
    return { ...block, content: newText };
  }
  if (Array.isArray(block.content)) {
    // Replace only text blocks, keep images etc.
    const newContent = block.content.map((c) =>
      c.type === "text" ? { ...c, text: newText } : c,
    );
    // If there were text blocks, replace the first and remove the rest
    let seenText = false;
    const filtered = newContent.filter((c) => {
      if (c.type !== "text") return true;
      if (!seenText) {
        seenText = true;
        return true;
      }
      return false;
    });
    return { ...block, content: filtered };
  }
  // No content field — add it as string
  return { ...block, content: newText };
}
