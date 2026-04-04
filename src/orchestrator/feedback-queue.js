// Structured feedback queue for inter-role communication.
// Replaces the flat session.last_reviewer_feedback string with typed messages.

/**
 * @typedef {Object} FeedbackEntry
 * @property {string} source - "reviewer" | "tester" | "security" | "sonar" | "audit" | "brain"
 * @property {string} severity - "critical" | "high" | "medium" | "low"
 * @property {string} category - "security" | "correctness" | "tests" | "style" | "performance" | "other"
 * @property {string} description
 * @property {string} [file]
 * @property {number} [line]
 * @property {string} [suggestedFix]
 * @property {string} [id]
 * @property {number} [iteration] - when this feedback was added
 */

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const CATEGORY_ORDER = { security: 0, correctness: 1, tests: 2, performance: 3, style: 4, other: 5 };

/**
 * Create a new empty feedback queue.
 */
export function createQueue() {
  return { entries: [] };
}

/**
 * Add a feedback entry to the queue.
 */
export function addEntry(queue, entry) {
  if (!entry || !entry.description) return queue;
  const normalized = {
    source: entry.source || "unknown",
    severity: entry.severity || "medium",
    category: entry.category || "other",
    description: entry.description,
    file: entry.file || null,
    line: entry.line || null,
    suggestedFix: entry.suggestedFix || null,
    id: entry.id || null,
    iteration: entry.iteration || 0
  };
  queue.entries.push(normalized);
  return queue;
}

/**
 * Add multiple entries at once.
 */
export function addEntries(queue, entries) {
  for (const e of entries || []) addEntry(queue, e);
  return queue;
}

/**
 * Deduplicate entries with the same description + source (keep the most severe).
 */
export function deduplicate(queue) {
  const seen = new Map();
  for (const e of queue.entries) {
    const key = `${e.source}::${e.description}`;
    const existing = seen.get(key);
    if (!existing || SEVERITY_ORDER[e.severity] < SEVERITY_ORDER[existing.severity]) {
      seen.set(key, e);
    }
  }
  queue.entries = [...seen.values()];
  return queue;
}

/**
 * Sort entries by priority: category first (security > correctness > ...), then severity.
 */
export function prioritize(queue) {
  queue.entries.sort((a, b) => {
    const catDiff = (CATEGORY_ORDER[a.category] ?? 5) - (CATEGORY_ORDER[b.category] ?? 5);
    if (catDiff !== 0) return catDiff;
    return (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2);
  });
  return queue;
}

/**
 * Format queue as a numbered list for the coder prompt.
 */
export function formatForCoder(queue) {
  if (!queue.entries.length) return "";

  const lines = [];
  queue.entries.forEach((e, i) => {
    const loc = e.file ? ` (${e.file}${e.line ? `:${e.line}` : ""})` : "";
    const tag = `[${e.source}:${e.severity}:${e.category}]`;
    lines.push(`${i + 1}. ${tag}${loc} ${e.description}`);
    if (e.suggestedFix) lines.push(`   Fix: ${e.suggestedFix}`);
  });
  return lines.join("\n");
}

/**
 * Filter entries by category.
 */
export function filterByCategory(queue, category) {
  return { entries: queue.entries.filter(e => e.category === category) };
}

/**
 * Check if queue has any critical/high severity entries.
 */
export function hasBlockingIssues(queue) {
  return queue.entries.some(e => e.severity === "critical" || e.severity === "high");
}

/**
 * Get count of entries by category.
 */
export function countByCategory(queue) {
  const counts = {};
  for (const e of queue.entries) {
    counts[e.category] = (counts[e.category] || 0) + 1;
  }
  return counts;
}

/**
 * Clear the queue (after coder addresses the feedback).
 */
export function clear(queue) {
  queue.entries = [];
  return queue;
}

/**
 * Serialize queue for persistence in session.
 */
export function serialize(queue) {
  return JSON.stringify(queue);
}

/**
 * Deserialize queue from session.
 */
export function deserialize(str) {
  if (!str) return createQueue();
  try {
    const parsed = JSON.parse(str);
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return createQueue();
  }
}

export { SEVERITY_ORDER, CATEGORY_ORDER };
