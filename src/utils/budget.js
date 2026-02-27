import { calculateUsageCostUsd, DEFAULT_MODEL_PRICING, mergePricing } from "./pricing.js";

function toSafeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function roundUsd(value) {
  return Number(toSafeNumber(value).toFixed(6));
}

function normalizeLimit(limit) {
  if (limit === null || limit === undefined || limit === "") return null;
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function addToBreakdown(map, key, entry) {
  const current = map[key] || { tokens_in: 0, tokens_out: 0, total_tokens: 0, total_cost_usd: 0, count: 0 };
  current.tokens_in += entry.tokens_in;
  current.tokens_out += entry.tokens_out;
  current.total_tokens += entry.tokens_in + entry.tokens_out;
  current.total_cost_usd = roundUsd(current.total_cost_usd + entry.cost_usd);
  current.count += 1;
  map[key] = current;
}

export class BudgetTracker {
  constructor(options = {}) {
    this.entries = [];
    this.pricing = mergePricing(DEFAULT_MODEL_PRICING, options.pricing || {});
  }

  record({ role, provider, model, tokens_in, tokens_out, cost_usd } = {}) {
    const safeTokensIn = toSafeNumber(tokens_in);
    const safeTokensOut = toSafeNumber(tokens_out);
    const hasExplicitCost = cost_usd !== undefined && cost_usd !== null && cost_usd !== "";
    const modelName = model || provider || null;
    const computedCost = calculateUsageCostUsd({
      model: modelName,
      tokens_in: safeTokensIn,
      tokens_out: safeTokensOut,
      pricing: this.pricing
    });
    const entry = {
      role: role || "unknown",
      provider: provider || "unknown",
      model: modelName,
      timestamp: new Date().toISOString(),
      tokens_in: safeTokensIn,
      tokens_out: safeTokensOut,
      cost_usd: roundUsd(hasExplicitCost ? cost_usd : computedCost)
    };
    this.entries.push(entry);
    return entry;
  }

  total() {
    let tokensIn = 0;
    let tokensOut = 0;
    let totalCost = 0;
    for (const entry of this.entries) {
      tokensIn += entry.tokens_in;
      tokensOut += entry.tokens_out;
      totalCost = roundUsd(totalCost + entry.cost_usd);
    }
    return {
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: totalCost
    };
  }

  remaining(limit) {
    const n = normalizeLimit(limit);
    if (n === null) return Infinity;
    return roundUsd(n - this.total().cost_usd);
  }

  isOverBudget(limit) {
    const n = normalizeLimit(limit);
    if (n === null) return false;
    return this.total().cost_usd > n;
  }

  summary() {
    const totals = this.total();
    const byRole = {};

    for (const entry of this.entries) {
      addToBreakdown(byRole, entry.role, entry);
    }

    return {
      total_tokens: totals.tokens_in + totals.tokens_out,
      total_cost_usd: totals.cost_usd,
      breakdown_by_role: byRole,
      entries: [...this.entries]
    };
  }
}
