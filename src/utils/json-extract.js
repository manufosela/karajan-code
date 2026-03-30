/**
 * Robust JSON extraction from agent output.
 * Extracts the first complete JSON object from a string,
 * ignoring any trailing text that would cause parse errors.
 */

/**
 * Extract the first valid JSON object from a raw string.
 * Handles cases where agents output valid JSON followed by extra text.
 * @param {string} raw - Raw agent output.
 * @returns {object|null} Parsed JSON object, or null if no valid JSON found.
 */
export function extractFirstJson(raw) {
  if (!raw) return null;
  const str = typeof raw === "string" ? raw.trim() : String(raw).trim();
  if (!str) return null;

  // Fast path: try parsing the whole string first
  try {
    return JSON.parse(str);
  } catch { /* fall through to extraction */ }

  // Find the first '{' and match to its closing '}'
  const start = str.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    if (ch === "}") depth--;

    if (depth === 0) {
      try {
        return JSON.parse(str.substring(start, i + 1));
      } catch { /* matched braces but not valid JSON */
        return null;
      }
    }
  }

  return null;
}
