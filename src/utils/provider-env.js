/**
 * Mapping of AI provider → required environment variable(s), plus helpers to
 * determine which ones are actually needed by the current active config.
 *
 * The Check subsystem uses this to validate tokens LAZILY: we only demand an
 * API key when a role is configured to use the provider behind it. Providers
 * that run fully locally (e.g. opencode via a self-hosted proxy) are marked
 * `optional: true` and only warn if their key is missing.
 */

/**
 * @typedef {Object} ProviderEnv
 * @property {string} provider
 * @property {string[]} envVars     - env var names that would satisfy the check (first match wins)
 * @property {string} howToGetUrl   - user-facing URL to obtain a key
 * @property {boolean} optional     - warn vs fail when missing
 */

/** @type {Record<string, ProviderEnv>} */
export const PROVIDER_ENV = Object.freeze({
  anthropic: {
    provider: "anthropic",
    envVars: ["ANTHROPIC_API_KEY"],
    howToGetUrl: "https://console.anthropic.com/settings/keys",
    optional: false,
  },
  openai: {
    provider: "openai",
    envVars: ["OPENAI_API_KEY"],
    howToGetUrl: "https://platform.openai.com/api-keys",
    optional: false,
  },
  google: {
    provider: "google",
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    howToGetUrl: "https://aistudio.google.com/app/apikey",
    optional: false,
  },
  opencode: {
    provider: "opencode",
    envVars: ["OPENCODE_API_KEY"],
    howToGetUrl: "https://opencode.ai/docs",
    optional: true, // local/self-hosted — may not need an API key
  },
  aider: {
    provider: "aider",
    envVars: ["AIDER_API_KEY"],
    howToGetUrl: "https://aider.chat/docs/usage.html",
    optional: true,
  },
});

/**
 * Returns true if any of the env vars for a provider is set non-empty.
 * @param {ProviderEnv} entry
 */
export function hasEnvVar(entry) {
  return entry.envVars.some((name) => {
    const v = process.env[name];
    return typeof v === "string" && v.trim().length > 0;
  });
}

/**
 * Walk the active config and collect the set of providers currently in use
 * by at least one role.
 *
 * @param {Object} config - Karajan config (loaded)
 * @returns {Set<string>} - set of provider slugs (e.g. "anthropic", "openai")
 */
export function collectActiveProviders(config) {
  const providers = new Set();
  const roles = config?.roles || {};
  for (const [, roleCfg] of Object.entries(roles)) {
    const provider = roleCfg?.provider;
    if (typeof provider === "string" && provider.trim().length > 0) {
      providers.add(provider);
    }
  }
  // Also include top-level default coder/reviewer if set (legacy shape).
  if (config?.coder) providers.add(config.coder);
  if (config?.reviewer) providers.add(config.reviewer);
  return providers;
}

/**
 * Map active providers to the env vars we must validate.
 *
 * @param {Object} config
 * @returns {ProviderEnv[]}
 */
export function getRequiredProviderEnvs(config) {
  const active = collectActiveProviders(config);
  const required = [];
  for (const providerSlug of active) {
    // Some configs store agent names (claude, codex, gemini) rather than
    // canonical provider names. Map them.
    const canonical = normalizeProvider(providerSlug);
    const entry = PROVIDER_ENV[canonical];
    if (entry) required.push(entry);
  }
  return required;
}

/**
 * Normalize CLI/agent name to canonical provider slug.
 */
export function normalizeProvider(name) {
  const lc = String(name || "").toLowerCase();
  if (lc === "claude" || lc === "anthropic") return "anthropic";
  if (lc === "codex" || lc === "openai") return "openai";
  if (lc === "gemini" || lc === "google") return "google";
  if (lc === "opencode") return "opencode";
  if (lc === "aider") return "aider";
  return lc;
}
