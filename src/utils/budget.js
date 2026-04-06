import { calculateUsageCostUsd, DEFAULT_MODEL_PRICING, mergePricing } from "./pricing.js";

/**
 * Estimate token counts from character lengths when CLIs don't report usage.
 * Rough heuristic: ~4 characters per token for English text.
 */
export function estimateTokens(promptLength, responseLength) {
  return {
    tokens_in: Math.ceil((promptLength || 0) / 4),
    tokens_out: Math.ceil((responseLength || 0) / 4),
    estimated: true
  };
}

export function extractUsageMetrics(result, defaultModel = null) {
  const usage = result?.usage || result?.metrics || {};
  const tokens_in =
    result?.tokens_in ??
    usage?.tokens_in ??
    usage?.input_tokens ??
    usage?.prompt_tokens ??
    0;
  const tokens_out =
    result?.tokens_out ??
    usage?.tokens_out ??
    usage?.output_tokens ??
    usage?.completion_tokens ??
    0;
  const cost_usd =
    result?.cost_usd ??
    usage?.cost_usd ??
    usage?.usd_cost ??
    usage?.cost;
  const model =
    result?.model ??
    usage?.model ??
    usage?.model_name ??
    usage?.model_id ??
    defaultModel ??
    null;

  // If no real token data AND no explicit cost, estimate from prompt/output sizes.
  // Primary: uses result.promptSize when explicitly provided.
  // Fallback: estimates from result.output or result.error text length.
  let estimated = false;
  let finalTokensIn = tokens_in;
  let finalTokensOut = tokens_out;
  const hasExplicitCost = cost_usd !== undefined && cost_usd !== null && cost_usd !== "";
  if (!tokens_in && !tokens_out && !hasExplicitCost) {
    const outputText = result?.output || result?.error || result?.summary || "";
    const promptSize = result?.promptSize || 0;
    const MIN_TEXT_FOR_ESTIMATION = 40;
    if (promptSize > 0 || outputText.length >= MIN_TEXT_FOR_ESTIMATION) {
      const est = estimateTokens(promptSize, outputText.length);
      finalTokensIn = est.tokens_in;
      finalTokensOut = est.tokens_out;
      estimated = true;
    }
  }

  return { tokens_in: finalTokensIn, tokens_out: finalTokensOut, cost_usd, model, estimated };
}

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

  record({ role, provider, model, tokens_in, tokens_out, cost_usd, duration_ms, stage_index, estimated } = {}) {
    const safeTokensIn = toSafeNumber(tokens_in);
    const safeTokensOut = toSafeNumber(tokens_out);
    const hasExplicitCost = cost_usd !== undefined && cost_usd !== null && cost_usd !== "";
    const modelName = model || provider || null;
    const computedCost = calculateUsageCostUsd({
      provider: provider,
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
    if (duration_ms !== undefined && duration_ms !== null) {
      entry.duration_ms = toSafeNumber(duration_ms);
    }
    if (stage_index !== undefined && stage_index !== null) {
      entry.stage_index = Number(stage_index);
    }
    if (estimated) {
      entry.estimated = true;
    }
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

  hasUsageData() {
    return this.entries.length > 0 && (this.total().tokens_in > 0 || this.total().tokens_out > 0 || this.total().cost_usd > 0);
  }

  summary() {
    const totals = this.total();
    const byRole = {};

    for (const entry of this.entries) {
      addToBreakdown(byRole, entry.role, entry);
    }

    const hasEstimates = this.entries.some(e => e.estimated);
    const result = {
      total_tokens: totals.tokens_in + totals.tokens_out,
      total_cost_usd: totals.cost_usd,
      breakdown_by_role: byRole,
      entries: [...this.entries],
      usage_available: this.hasUsageData()
    };
    if (hasEstimates) result.includes_estimates = true;
    return result;
  }

  trace() {
    return this.entries.map((entry, index) => {
      const item = {
        index: entry.stage_index ?? index,
        role: entry.role,
        provider: entry.provider,
        model: entry.model,
        timestamp: entry.timestamp,
        duration_ms: entry.duration_ms ?? null,
        tokens_in: entry.tokens_in,
        tokens_out: entry.tokens_out,
        cost_usd: entry.cost_usd
      };
      if (entry.estimated) item.estimated = true;
      return item;
    });
  }
}
