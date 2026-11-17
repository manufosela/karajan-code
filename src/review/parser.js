/**
 * Review output parsing helpers.
 * Extracted from orchestrator.js to improve testability and reduce complexity.
 */

import { extractFirstJson } from "../utils/json-extract.js";

export function parseMaybeJsonString(value) {
  if (typeof value !== "string") return null;
  return extractFirstJson(value);
}

/**
 * KJC-BUG-0357 (#2151): claude's reviewTask answers with its whole stream-json
 * event stream, which opens with hook and init events, so its first JSON is no
 * answer. The answer is the text of the final `result` event; any other output
 * is returned as it came.
 */
export function agentAnswerText(raw) {
  if (typeof raw !== "string") return raw;
  const lines = raw.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const event = extractFirstJson(lines[i]);
    if (event?.type === "result" && typeof event.result === "string") return event.result;
  }
  return opencodeText(lines) ?? raw;
}

// HU-4569: opencode run --format json streams step_start / text / tool_use / step_finish events;
// the answer is the text of the last step that wrote any.
function opencodeText(lines) {
  let step = [];
  let answer = null;
  for (const line of lines) {
    const event = extractFirstJson(line);
    if (event?.type === "step_start") step = [];
    else if (event?.type === "text" && typeof event.part?.text === "string") {
      step.push(event.part.text);
      answer = step.join("");
    }
  }
  return answer;
}

/** The review verdict in an agent's answer, or null: the one path kj review reads it by. */
export function parseReviewVerdict(output) {
  return normalizeReviewPayload(parseMaybeJsonString(agentAnswerText(output)));
}

function isReviewPayload(obj) {
  return obj?.approved !== undefined && obj?.blocking_issues !== undefined;
}

function findReviewInArray(arr) {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const item = arr[i];
    if (isReviewPayload(item)) return item;

    const nested = item?.result || item?.message?.content?.[0]?.text;
    if (typeof nested === "string") {
      const parsedNested = parseMaybeJsonString(nested);
      if (parsedNested?.approved !== undefined) return parsedNested;
    }
  }
  return null;
}

export function normalizeReviewPayload(payload) {
  if (!payload) return null;
  if (isReviewPayload(payload)) return payload;
  if (Array.isArray(payload)) return findReviewInArray(payload);

  // KJC-BUG-0146 — the verdict often arrives WRAPPED by the CLI that produced it:
  // {"ok":true,"result":{approved,...}}. Only the string form was unwrapped, so a
  // perfectly good approval from codex was thrown away as "no parseable verdict"
  // eight times in three days. The evidence came from the raw answer this bug's
  // first fix started saving.
  if (typeof payload.result === "string") {
    const parsedResult = parseMaybeJsonString(payload.result);
    if (parsedResult?.approved !== undefined) return parsedResult;
  }
  if (payload.result && typeof payload.result === "object") {
    const inner = normalizeReviewPayload(payload.result);
    if (inner) return inner;
  }

  return null;
}

export function parseJsonOutput(raw) {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  try {
    const parsed = JSON.parse(cleaned);
    return normalizeReviewPayload(parsed);
  } catch { /* not a single JSON blob */
    const lines = cleaned
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    const parsedLines = [];
    for (const line of lines) {
      try {
        parsedLines.push(JSON.parse(line));
      } catch { /* line is not JSON */
        continue;
      }
    }

    const normalizedLines = normalizeReviewPayload(parsedLines);
    if (normalizedLines) {
      return normalizedLines;
    }

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const parsed = JSON.parse(lines[i]);
        return normalizeReviewPayload(parsed);
      } catch { /* line is not JSON */
        continue;
      }
    }
  }
  return null;
}
