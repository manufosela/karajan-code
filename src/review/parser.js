/**
 * Review output parsing helpers.
 * Extracted from orchestrator.js to improve testability and reduce complexity.
 */

export function parseMaybeJsonString(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const candidate = value.slice(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function normalizeReviewPayload(payload) {
  if (!payload) return null;

  if (payload.approved !== undefined && payload.blocking_issues !== undefined) {
    return payload;
  }

  if (Array.isArray(payload)) {
    for (let i = payload.length - 1; i >= 0; i -= 1) {
      const item = payload[i];
      if (item?.approved !== undefined && item?.blocking_issues !== undefined) {
        return item;
      }

      const nested = item?.result || item?.message?.content?.[0]?.text;
      if (typeof nested === "string") {
        const parsedNested = parseMaybeJsonString(nested);
        if (parsedNested?.approved !== undefined) return parsedNested;
      }
    }
    return null;
  }

  if (typeof payload.result === "string") {
    const parsedResult = parseMaybeJsonString(payload.result);
    if (parsedResult?.approved !== undefined) return parsedResult;
    return null;
  }

  return null;
}

export function parseJsonOutput(raw) {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  try {
    const parsed = JSON.parse(cleaned);
    return normalizeReviewPayload(parsed);
  } catch {
    const lines = cleaned
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    const parsedLines = [];
    for (const line of lines) {
      try {
        parsedLines.push(JSON.parse(line));
      } catch {
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
      } catch {
        continue;
      }
    }
  }
  return null;
}
