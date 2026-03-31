/**
 * MCP response compressor — reduces token consumption by stripping
 * verbose fields from list payloads and truncating oversized arrays.
 */

// Fields to strip from list items (keep in single-item detail views)
const STRIP_FROM_LIST_ITEMS = [
  "descriptionStructured", "acceptanceCriteriaStructured",
  "implementationPlan", "implementationNotes",
  "developmentInstructions", "raw", "textSummary",
  "workCycles", "config_snapshot", "paused_state",
  "checkpoints"
];

// Fields to strip from all responses (never useful to the LLM)
const ALWAYS_STRIP = [
  "firebaseId", "cardType", "group", "createdBy", "updatedBy",
  "_instance"
];

const MAX_ARRAY_ITEMS = 20;
const MAX_COMMITS = 5;
const MAX_FINDINGS = 10;

export function compressResponse(data, toolName = "") {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return compressArray(data);

  const compressed = { ...data };

  // Strip always-remove fields
  for (const key of ALWAYS_STRIP) delete compressed[key];

  // Compress nested arrays and objects
  for (const [key, value] of Object.entries(compressed)) {
    if (Array.isArray(value)) {
      if (key === "commits") compressed[key] = truncateFromEnd(value, MAX_COMMITS);
      else if (key === "findings" || key === "blocking_issues") compressed[key] = truncateFromStart(value, MAX_FINDINGS);
      else compressed[key] = compressArray(value);
    } else if (value && typeof value === "object") {
      compressed[key] = compressResponse(value, toolName);
    }
  }

  return compressed;
}

function compressArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return arr;

  // Strip verbose fields from list items
  const stripped = arr.map(item => {
    if (!item || typeof item !== "object") return item;
    const clean = { ...item };
    for (const key of STRIP_FROM_LIST_ITEMS) delete clean[key];
    for (const key of ALWAYS_STRIP) delete clean[key];
    return clean;
  });

  if (stripped.length <= MAX_ARRAY_ITEMS) return stripped;

  const truncated = stripped.slice(0, MAX_ARRAY_ITEMS);
  truncated.push({ _truncated: true, _total: arr.length, _showing: MAX_ARRAY_ITEMS });
  return truncated;
}

function truncateFromEnd(arr, max) {
  if (arr.length <= max) return arr;
  return [{ _note: `${arr.length - max} earlier items omitted` }, ...arr.slice(-max)];
}

function truncateFromStart(arr, max) {
  if (arr.length <= max) return arr;
  const truncated = arr.slice(0, max);
  truncated.push({ _note: `... and ${arr.length - max} more` });
  return truncated;
}

export function compactStringify(data) {
  return JSON.stringify(data);
}
