/**
 * Compute "With KJ" vs "Without KJ" budget comparison.
 *
 * Karajan reduces token consumption through two mechanisms:
 *   1. RTK proxy compression (token-level output compression via the
 *      Rust Token Killer proxy). Tracked as `rtkSavings.estimatedTokensSaved`.
 *   2. Brain role-output compression (summarization/trimming of inter-role
 *      outputs). Tracked in `brainCtx.compressionStats.totalSaved`.
 *
 * Given the real billed usage (from BudgetTracker) plus the saved tokens,
 * this helper projects what usage would have been without KJ's compressions.
 *
 * Cost projection uses the blended rate from the real usage:
 *   withoutKjCost = realCost * (realTokens + savedTokens) / realTokens
 *
 * When no compression data is available, `hasCompression` is false and the
 * caller should render only the real cost (no comparison).
 */

/**
 * @typedef {Object} KjComparison
 * @property {boolean} hasCompression              - whether any savings data exists
 * @property {{ tokens: number, cost: number }} withKj
 * @property {{ tokens: number, cost: number }} withoutKj
 * @property {number} savedTokens                  - total tokens saved
 * @property {number} savedPct                     - savings as percent of the "without" total (0..100)
 * @property {{ rtkTokens: number, brainTokens: number }} breakdown
 */

/**
 * Compute the comparison from the current budget snapshot and available
 * compression stats.
 *
 * @param {Object} args
 * @param {number} [args.realTokens]                   - budget tracker total tokens
 * @param {number} [args.realCost]                     - budget tracker cost in USD
 * @param {{ estimatedTokensSaved?: number }} [args.rtkSavings]
 * @param {{ compressionStats?: { totalSaved?: number } } | null} [args.brainCtx]
 * @returns {KjComparison}
 */
export function computeKjComparison({ realTokens = 0, realCost = 0, rtkSavings = null, brainCtx = null } = {}) {
  const realT = Math.max(0, Number(realTokens) || 0);
  const realC = Math.max(0, Number(realCost) || 0);

  const rtkTokens = Math.max(0, Number(rtkSavings?.estimatedTokensSaved) || 0);
  const brainTokens = Math.max(0, Number(brainCtx?.compressionStats?.totalSaved) || 0);
  const savedTokens = rtkTokens + brainTokens;

  if (savedTokens === 0 || realT === 0) {
    return {
      hasCompression: false,
      withKj: { tokens: realT, cost: realC },
      withoutKj: { tokens: realT, cost: realC },
      savedTokens: 0,
      savedPct: 0,
      breakdown: { rtkTokens, brainTokens },
    };
  }

  const withoutKjTokens = realT + savedTokens;
  const blendedRate = realC / realT;
  const withoutKjCost = Number((blendedRate * withoutKjTokens).toFixed(4));
  const savedPct = Number(((savedTokens / withoutKjTokens) * 100).toFixed(1));

  return {
    hasCompression: true,
    withKj: { tokens: realT, cost: Number(realC.toFixed(4)) },
    withoutKj: { tokens: withoutKjTokens, cost: withoutKjCost },
    savedTokens,
    savedPct,
    breakdown: { rtkTokens, brainTokens },
  };
}

/**
 * Render a one-line comparison string for the CLI display. Returns null
 * when there's no compression data (so the caller can fall back to the
 * plain budget line).
 *
 * Example outputs:
 *   "With KJ: $0.06 / 1,287 tokens · Without KJ: ~$1.30 / ~11,324 tokens (-89%)"
 *
 * @param {KjComparison} cmp
 * @returns {string|null}
 */
export function formatComparisonLine(cmp) {
  if (!cmp?.hasCompression) return null;
  const fmt = (n) => n.toLocaleString("en-US");
  const tok = (n) => `${fmt(n)} tokens`;
  const cost = (n) => `$${n.toFixed(2)}`;
  return [
    `With KJ: ${cost(cmp.withKj.cost)} / ${tok(cmp.withKj.tokens)}`,
    `Without KJ: ~${cost(cmp.withoutKj.cost)} / ~${tok(cmp.withoutKj.tokens)}`,
    `(-${cmp.savedPct.toFixed(0)}%)`,
  ].join(" · ");
}
