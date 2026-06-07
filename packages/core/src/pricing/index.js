/**
 * Model pricing registry (Cost A — KJC-TSK-0512).
 *
 * Static $-per-1M-tokens lookup. The cost-aggregator (Cost B) turns
 * `{tokens_in, tokens_out, model}` events from the orchestrator into
 * USD without calling external pricing APIs at runtime.
 *
 * Unknown models return `null` — the aggregator records the run as
 * `cost: "unknown"` instead of throwing, so a brand-new model id
 * never blocks a kj run.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, "model-pricing.json");

let _cached = null;

function loadRegistry() {
  if (_cached) return _cached;
  const raw = readFileSync(REGISTRY_PATH, "utf8");
  _cached = JSON.parse(raw);
  return _cached;
}

/**
 * Look up pricing for a model id.
 *
 * @param {string} modelId — e.g. "claude-opus-4-7", "gpt-4o".
 * @returns {{inputPerMTok:number, outputPerMTok:number, currency:string, source:string, updatedAt:string} | null}
 */
export function getModelPricing(modelId) {
  if (typeof modelId !== "string" || modelId.length === 0) return null;
  const reg = loadRegistry();
  const entry = reg[modelId];
  if (!entry || modelId.startsWith("_")) return null;
  return {
    inputPerMTok: entry.inputPerMTok,
    outputPerMTok: entry.outputPerMTok,
    currency: reg._meta.currency,
    source: entry.source,
    updatedAt: reg._meta.updatedAt,
  };
}

/**
 * List every known model id (no metadata). Useful for diagnostics
 * and future `kj doctor` checks.
 */
export function listKnownModels() {
  const reg = loadRegistry();
  return Object.keys(reg).filter((k) => !k.startsWith("_"));
}

/**
 * Reset the in-memory cache. Tests use this to re-read the JSON
 * after mutating it; production code never needs to call it.
 */
export function _resetCache() {
  _cached = null;
}
