/**
 * Review output parsing helpers.
 * Extracted from orchestrator.js to improve testability and reduce complexity.
 */

import { extractFirstJson } from "../utils/json-extract.js";

export function parseMaybeJsonString(value) {
  if (typeof value !== "string") return null;
  return extractFirstJson(value);
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

  if (typeof payload.result === "string") {
    const parsedResult = parseMaybeJsonString(payload.result);
    if (parsedResult?.approved !== undefined) return parsedResult;
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
