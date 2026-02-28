export const DEFAULT_MODEL_PRICING = {
  "claude": { input_per_million: 3, output_per_million: 15 },
  "claude/sonnet": { input_per_million: 3, output_per_million: 15 },
  "claude/opus": { input_per_million: 15, output_per_million: 75 },
  "claude/haiku": { input_per_million: 0.25, output_per_million: 1.25 },
  "codex": { input_per_million: 1.5, output_per_million: 4 },
  "codex/o4-mini": { input_per_million: 1.5, output_per_million: 4 },
  "codex/o3": { input_per_million: 10, output_per_million: 40 },
  "gemini": { input_per_million: 1.25, output_per_million: 5 },
  "gemini/pro": { input_per_million: 1.25, output_per_million: 5 },
  "gemini/flash": { input_per_million: 0.075, output_per_million: 0.3 },
  "aider": { input_per_million: 3, output_per_million: 15 }
};

export function calculateUsageCostUsd({ model, tokens_in, tokens_out, pricing }) {
  const table = pricing || DEFAULT_MODEL_PRICING;
  const entry = table[model] || null;
  if (!entry) return 0;

  const inputCost = (tokens_in * entry.input_per_million) / 1_000_000;
  const outputCost = (tokens_out * entry.output_per_million) / 1_000_000;
  return inputCost + outputCost;
}

export function mergePricing(defaults, overrides) {
  if (!overrides || typeof overrides !== "object") return { ...defaults };
  return { ...defaults, ...overrides };
}
