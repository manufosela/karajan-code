// @ts-check

/**
 * @typedef {Object} ParsedOutput
 * @property {"json" | "text" | "empty"} format Normalized format detected in the output.
 * @property {unknown | null} json Parsed JSON value when format === "json", otherwise null.
 * @property {string} text Combined textual output (always present, may be empty).
 */

/**
 * Attempt to parse the entire string as strict JSON.
 * @param {string} raw
 * @returns {unknown | undefined} The parsed JSON or undefined if it is not strict JSON.
 */
function parseWholeJson(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const firstChar = trimmed[0];
  if (firstChar !== '{' && firstChar !== '[') return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * Attempt to extract the first balanced JSON object or array embedded in free text.
 * Performs a simple brace/bracket matcher while tracking strings and escape chars.
 *
 * @param {string} raw
 * @returns {unknown | undefined} The parsed JSON fragment or undefined if none found.
 */
function extractEmbeddedJson(raw) {
  if (!raw) return undefined;

  for (let start = 0; start < raw.length; start += 1) {
    const openChar = raw[start];
    if (openChar !== '{' && openChar !== '[') continue;

    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];

      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === openChar) depth += 1;
      else if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) {
          const candidate = raw.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break; // intenta con siguiente posición de apertura
          }
        }
      }
    }
  }
  return undefined;
}

/**
 * Build the normalized fallback object when no JSON could be extracted.
 * @param {string} stdout
 * @param {string} stderr
 * @returns {ParsedOutput}
 */
function buildNormalizedFallback(stdout, stderr) {
  const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
  if (!combined) {
    return { format: 'empty', json: null, text: '' };
  }
  return { format: 'text', json: null, text: combined };
}

/**
 * Normalize raw CLI output into a predictable structure suitable for downstream consumers.
 *
 * Strategy:
 *   1. Parse full stdout as JSON.
 *   2. If that fails, attempt to extract a JSON fragment embedded in stdout.
 *   3. Otherwise fallback to combined plain text (stdout + stderr).
 *   4. If nothing useful exists, return an empty format.
 *
 * @param {string} stdout
 * @param {string} [stderr]
 * @returns {ParsedOutput}
 */
export function parseCliOutput(stdout, stderr = '') {
  const safeStdout = typeof stdout === 'string' ? stdout : '';
  const safeStderr = typeof stderr === 'string' ? stderr : '';

  const whole = parseWholeJson(safeStdout);
  if (whole !== undefined) {
    return { format: 'json', json: whole, text: safeStdout };
  }

  const embedded = extractEmbeddedJson(safeStdout);
  if (embedded !== undefined) {
    return { format: 'json', json: embedded, text: safeStdout };
  }

  return buildNormalizedFallback(safeStdout, safeStderr);
}
