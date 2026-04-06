const modelRegistry = new Map();

export function registerModel(name, { provider, pricing, deprecated } = {}) {
	if (!name || typeof name !== "string") {
		throw new Error("Model name must be a non-empty string");
	}
	if (!pricing || typeof pricing.input_per_million !== "number" || typeof pricing.output_per_million !== "number") {
		throw new Error(`Model "${name}" requires pricing with input_per_million and output_per_million`);
	}
	modelRegistry.set(name, {
		name,
		provider: provider || name.split("/")[0],
		pricing: { input_per_million: pricing.input_per_million, output_per_million: pricing.output_per_million },
		deprecated: deprecated || null,
	});
}

export function registerModelAlias(alias, target, { provider } = {}) {
	const entry = modelRegistry.get(target);
	if (!entry) {
		throw new Error(`Target model "${target}" for alias "${alias}" not found`);
	}
	modelRegistry.set(alias, {
		...entry,
		name: alias,
		provider: provider || entry.provider
	});
}

export function getModelPricing(name) {
	const entry = modelRegistry.get(name);
	return entry ? { ...entry.pricing } : null;
}

export function isModelDeprecated(name) {
	const entry = modelRegistry.get(name);
	if (!entry?.deprecated) return false;
	return new Date(entry.deprecated) <= new Date();
}

export function getModelInfo(name) {
	const entry = modelRegistry.get(name);
	if (!entry) return null;
	return { name: entry.name, provider: entry.provider, pricing: { ...entry.pricing }, deprecated: entry.deprecated };
}

export function getRegisteredModels() {
	return [...modelRegistry.entries()].map(([name, entry]) => ({
		name: entry.name,
		provider: entry.provider,
		pricing: { ...entry.pricing },
		deprecated: entry.deprecated,
	}));
}

export function buildDefaultPricingTable() {
	const table = {};
	for (const [name, entry] of modelRegistry) {
		table[name] = { ...entry.pricing };
	}
	return table;
}

/**
 * Anthropic Claude Family
 * Pricing & Info: https://platform.claude.com/docs/en/about-claude/pricing
 */
registerModel("claude-opus-4.6", { provider: "anthropic", pricing: { input_per_million: 5.0, output_per_million: 25.0 } });
registerModel("claude-sonnet-4.6", { provider: "anthropic", pricing: { input_per_million: 3.0, output_per_million: 15.0 } });
registerModel("claude-haiku-4.5", { provider: "anthropic", pricing: { input_per_million: 1.0, output_per_million: 5.0 } });

// Default models & General aliases
registerModel("claude", { provider: "anthropic", pricing: { input_per_million: 3, output_per_million: 15 } });
registerModel("sonnet", { provider: "anthropic", pricing: { input_per_million: 3, output_per_million: 15 } });
registerModel("opus", { provider: "anthropic", pricing: { input_per_million: 15, output_per_million: 75 } });
registerModel("haiku", { provider: "anthropic", pricing: { input_per_million: 0.25, output_per_million: 1.25 } });

/**
 * OpenAI GPT Family
 * Pricing: https://developers.openai.com/api/docs/pricing
 */
registerModel("gpt-5.4-standard", { provider: "openai", pricing: { input_per_million: 2.5, output_per_million: 15.0 } });
registerModel("gpt-5.4-thinking", { provider: "openai", pricing: { input_per_million: 2.5, output_per_million: 15.0 } });
registerModel("gpt-5.4-pro", { provider: "openai", pricing: { input_per_million: 30.0, output_per_million: 180.0 } });
registerModel("gpt-5.4-mini", { provider: "openai", pricing: { input_per_million: 0.75, output_per_million: 4.5 } });

// Default models & General aliases
registerModel("codex", { provider: "openai", pricing: { input_per_million: 1.5, output_per_million: 4 } });
registerModel("o4-mini", { provider: "openai", pricing: { input_per_million: 1.5, output_per_million: 4 } });
registerModel("o3", { provider: "openai", pricing: { input_per_million: 10, output_per_million: 40 } });

/**
 * Google Gemini Family
 * Pricing: https://ai.google.dev/gemini-api/docs/pricing
 */
registerModel("gemini-3.1-pro-preview", { provider: "google", pricing: { input_per_million: 2.0, output_per_million: 12.0 } });
registerModel("gemini-3.1-flash-lite", { provider: "google", pricing: { input_per_million: 0.25, output_per_million: 1.5 } });
registerModel("gemini-3-flash-preview", { provider: "google", pricing: { input_per_million: 0.5, output_per_million: 3.0 } });
registerModel("gemini-2.5-pro", { provider: "google", pricing: { input_per_million: 1.25, output_per_million: 5 } });
registerModel("gemini-2.0-flash", { provider: "google", pricing: { input_per_million: 0.075, output_per_million: 0.3 } });

// Default models & General aliases
registerModelAlias("gemini", "gemini-2.5-pro");

/**
 * Other Providers & CLI Aliases
 */
registerModel("aider", { provider: "aider", pricing: { input_per_million: 3, output_per_million: 15 } });
registerModel("opencode", { provider: "opencode", pricing: { input_per_million: 0, output_per_million: 0 } });

// Common CLI Aliases (with provider overrides)
registerModelAlias("aider/claude-3-7-sonnet", "claude-sonnet-4.6", { provider: "aider" });
registerModelAlias("aider/gpt-4o", "gpt-5.4-standard", { provider: "aider" });
registerModelAlias("opencode/minimax-m2.5", "opencode", { provider: "opencode" });
