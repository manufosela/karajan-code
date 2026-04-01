/**
 * Gemini message format adapter.
 *
 * Gemini API uses `contents[]` where each content has `parts[]`.
 * Function responses appear as parts with a `functionResponse` field:
 * `{ functionResponse: { name: "...", response: { content: "..." } } }`
 *
 * Gemini does not use explicit IDs for function calls/responses. Instead,
 * the function name serves as the correlation key. When multiple calls to
 * the same function exist, we generate synthetic IDs combining turnIndex
 * and part index for disambiguation.
 *
 * @module
 */

/**
 * Extract tool results from Gemini-format messages (contents array).
 *
 * @param {Array<object>} messages - Gemini contents array
 * @returns {Array<{id: string, toolName: string, text: string, turnIndex: number}>}
 */
export function extractToolResults(messages) {
  const results = [];

  for (let i = 0; i < messages.length; i++) {
    const content = messages[i];
    if (!content || !Array.isArray(content.parts)) continue;

    for (let p = 0; p < content.parts.length; p++) {
      const part = content.parts[p];
      if (!part.functionResponse) continue;

      const fr = part.functionResponse;
      const toolName = fr.name || "unknown";
      const text = extractResponseText(fr.response);
      // Synthetic ID: turn index + part index (Gemini has no explicit IDs)
      const id = `gemini-${i}-${p}`;

      results.push({ id, toolName, text, turnIndex: i });
    }
  }

  return results;
}

/**
 * Rebuild messages replacing functionResponse content with compressed versions.
 *
 * @param {Array<object>} messages - Original Gemini contents array
 * @param {Map<string, string>|Record<string, string>} compressedMap - id → compressed text
 * @returns {Array<object>} Deep-cloned messages with replacements applied
 */
export function rebuildMessages(messages, compressedMap) {
  const map = compressedMap instanceof Map ? compressedMap : new Map(Object.entries(compressedMap));

  return messages.map((content, i) => {
    if (!content || !Array.isArray(content.parts)) return content;

    const newParts = content.parts.map((part, p) => {
      if (!part.functionResponse) return part;

      const id = `gemini-${i}-${p}`;
      if (!map.has(id)) return part;

      const compressed = map.get(id);
      return {
        ...part,
        functionResponse: {
          ...part.functionResponse,
          response: replaceResponseText(part.functionResponse.response, compressed),
        },
      };
    });

    return { ...content, parts: newParts };
  });
}

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Extract text from a Gemini function response object.
 * The response can have `content` (string), `result` (string),
 * or be a nested object that we JSON-serialize.
 */
function extractResponseText(response) {
  if (!response) return "";
  if (typeof response === "string") return response;
  if (typeof response.content === "string") return response.content;
  if (typeof response.result === "string") return response.result;
  // For structured responses, serialize to JSON
  return JSON.stringify(response);
}

/**
 * Replace text in a Gemini function response object.
 * Preserves the original shape (content field, result field, etc.).
 */
function replaceResponseText(response, newText) {
  if (!response) return { content: newText };
  if (typeof response === "string") return newText;
  if (typeof response.content === "string") return { ...response, content: newText };
  if (typeof response.result === "string") return { ...response, result: newText };
  // Default: replace with content field
  return { content: newText };
}
