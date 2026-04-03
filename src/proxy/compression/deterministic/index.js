/**
 * Deterministic compression dispatcher.
 * Tries known patterns in order of specificity; returns original text if nothing matches.
 */
import { BASH_COMPRESSORS } from "./bash-compressors.js";
import { TOOL_COMPRESSORS } from "./tool-compressors.js";

/**
 * Compress tool output deterministically.
 * @param {string} text - raw tool output
 * @param {string} [toolName] - tool name hint (e.g. "Bash", "Grep", "Read", "Glob")
 * @returns {{ text: string, compressed: boolean }}
 */
export function compressDeterministic(text, toolName = "") {
  if (!text || typeof text !== "string") return { text: text ?? "", compressed: false };

  // Direct tool match
  const directCompressor = TOOL_COMPRESSORS[toolName];
  if (directCompressor && directCompressor.looksLike(text)) {
    return { text: directCompressor.compact(text), compressed: true };
  }

  // For Bash or unknown tools, try all bash compressors in order
  if (!toolName || toolName === "Bash") {
    for (const compressor of BASH_COMPRESSORS) {
      if (compressor.looksLike(text)) {
        return { text: compressor.compact(text), compressed: true };
      }
    }
  }

  return { text, compressed: false };
}
