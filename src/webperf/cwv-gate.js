/**
 * Core Web Vitals quality gate.
 *
 * Evaluates LCP, CLS and INP against Google's recommended thresholds
 * and returns a structured verdict usable by the pipeline.
 */

export const CWV_THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  cls: { good: 0.1, poor: 0.25 },
  inp: { good: 200, poor: 500 }
};

/**
 * Deep-merge custom thresholds on top of the defaults.
 * Only overrides metrics/boundaries that the caller provides.
 *
 * @param {object} defaults - Base thresholds (e.g. CWV_THRESHOLDS)
 * @param {object} [custom]  - Partial overrides
 * @returns {object} Merged thresholds
 */
export function mergeThresholds(defaults, custom) {
  if (!custom || typeof custom !== "object") return { ...defaults };

  const merged = {};
  for (const metric of Object.keys(defaults)) {
    const base = defaults[metric];
    const over = custom[metric];
    if (over && typeof over === "object") {
      merged[metric] = {
        good: over.good !== undefined ? over.good : base.good,
        poor: over.poor !== undefined ? over.poor : base.poor
      };
    } else {
      merged[metric] = { ...base };
    }
  }

  // Include any extra metrics the caller added that are not in defaults
  for (const metric of Object.keys(custom)) {
    if (!merged[metric] && typeof custom[metric] === "object") {
      merged[metric] = { ...custom[metric] };
    }
  }

  return merged;
}

function rateMetric(value, good, poor) {
  if (value <= good) return "good";
  if (value >= poor) return "poor";
  return "needs-improvement";
}

/**
 * Evaluate Core Web Vitals metrics against thresholds.
 *
 * @param {{ lcp?: number, cls?: number, inp?: number }} metrics
 * @param {object} [customThresholds] - Optional per-metric overrides
 * @returns {{
 *   pass: boolean,
 *   scores: Record<string, { value: number, rating: string }>,
 *   blocking: Array<{ metric: string, value: number, threshold: number, rating: string }>,
 *   advisory: Array<{ metric: string, value: number, threshold: number, rating: string }>
 * }}
 */
export function evaluateCwv(metrics, customThresholds) {
  const thresholds = mergeThresholds(CWV_THRESHOLDS, customThresholds);

  const scores = {};
  const blocking = [];
  const advisory = [];

  for (const [metric, bounds] of Object.entries(thresholds)) {
    const value = metrics[metric];
    if (value === undefined || value === null) continue;

    const rating = rateMetric(value, bounds.good, bounds.poor);
    scores[metric] = { value, rating };

    if (rating === "poor") {
      blocking.push({ metric, value, threshold: bounds.poor, rating });
    } else if (rating === "needs-improvement") {
      advisory.push({ metric, value, threshold: bounds.good, rating });
    }
  }

  return {
    pass: blocking.length === 0,
    scores,
    blocking,
    advisory
  };
}
