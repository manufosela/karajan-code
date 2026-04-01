/**
 * Provider adapter registry.
 *
 * Each adapter implements the contract:
 *   extractToolResults(messages) → [{id, toolName, text, turnIndex}]
 *   rebuildMessages(messages, compressedMap) → messages
 *
 * @module
 */

import * as anthropic from "./anthropic.js";
import * as openai from "./openai.js";
import * as gemini from "./gemini.js";

const adapters = {
  anthropic,
  openai,
  gemini,
};

/**
 * Hostname → provider mapping.
 * @type {Record<string, string>}
 */
const HOST_MAP = {
  "api.anthropic.com": "anthropic",
  "api.openai.com": "openai",
  "generativelanguage.googleapis.com": "gemini",
};

/**
 * Get the adapter for a given provider name.
 *
 * @param {string} provider - "anthropic" | "openai" | "gemini"
 * @returns {object|null} Adapter with extractToolResults and rebuildMessages, or null
 */
export function getAdapter(provider) {
  return adapters[provider] || null;
}

/**
 * Detect the provider from a hostname.
 *
 * @param {string} hostname - e.g. "api.anthropic.com", "api.openai.com:443"
 * @returns {string} Provider name or "unknown"
 */
export function detectProvider(hostname) {
  // Strip port if present
  const host = (hostname || "").split(":")[0];
  return HOST_MAP[host] || "unknown";
}
