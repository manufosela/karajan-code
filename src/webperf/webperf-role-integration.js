/**
 * Integration helpers that format CWV gate results for the
 * impeccable prompt and for pipeline progress events.
 */

const RATING_ICONS = { good: "PASS", "needs-improvement": "WARN", poor: "FAIL" };

/**
 * Build a human-readable section for the impeccable prompt.
 *
 * @param {{ pass: boolean, scores: object, blocking: Array, advisory: Array }} cwvResult
 * @returns {string}
 */
export function buildWebPerfSection(cwvResult) {
  const lines = [];
  const verdict = cwvResult.pass ? "PASSED" : "FAILED";
  lines.push(`## WebPerf — Core Web Vitals (${verdict})`);
  lines.push("");

  for (const [metric, { value, rating }] of Object.entries(cwvResult.scores)) {
    const icon = RATING_ICONS[rating] || rating;
    const unit = metric === "cls" ? "" : "ms";
    lines.push(`- **${metric.toUpperCase()}**: ${value}${unit} [${icon}]`);
  }

  if (cwvResult.blocking.length > 0) {
    lines.push("");
    lines.push("### Blocking issues");
    for (const b of cwvResult.blocking) {
      const unit = b.metric === "cls" ? "" : "ms";
      lines.push(`- ${b.metric.toUpperCase()}: ${b.value}${unit} exceeds poor threshold (${b.threshold}${unit})`);
    }
  }

  if (cwvResult.advisory.length > 0) {
    lines.push("");
    lines.push("### Advisory (needs improvement)");
    for (const a of cwvResult.advisory) {
      const unit = a.metric === "cls" ? "" : "ms";
      lines.push(`- ${a.metric.toUpperCase()}: ${a.value}${unit} exceeds good threshold (${a.threshold}${unit})`);
    }
  }

  return lines.join("\n");
}

/**
 * Format CWV result for a pipeline progress event payload.
 *
 * @param {{ pass: boolean, scores: object, blocking: Array, advisory: Array }} cwvResult
 * @returns {{ type: string, pass: boolean, metrics: object, blockingCount: number, advisoryCount: number }}
 */
export function formatCwvForEvent(cwvResult) {
  const metrics = {};
  for (const [metric, { value, rating }] of Object.entries(cwvResult.scores)) {
    metrics[metric] = { value, rating };
  }

  return {
    type: "webperf-cwv",
    pass: cwvResult.pass,
    metrics,
    blockingCount: cwvResult.blocking.length,
    advisoryCount: cwvResult.advisory.length
  };
}
