/**
 * Compression pipeline orchestrator.
 *
 * 5-step pipeline: extract → dedup → deterministic → ai-compress → rebuild.
 *
 * @module
 */

import { createHash } from "node:crypto";
import { compressDeterministic } from "./deterministic/index.js";
import { countTokens } from "./deterministic/utils.js";

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** SHA-256 hex digest of a string. */
function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Adaptive pressure
// ---------------------------------------------------------------------------

/**
 * Estimate context pressure and return the token threshold above which
 * tool_results should be compressed.
 *
 * @param {Array} messages - conversation messages
 * @param {number} modelMaxTokens - model context window size in tokens
 * @returns {{ ratio: number, threshold: number, level: string }}
 */
export function estimatePressure(messages, modelMaxTokens) {
  const totalTokens = countTokens(JSON.stringify(messages));
  const ratio = totalTokens / modelMaxTokens;

  if (ratio > 0.9) return { ratio, threshold: 200, level: "critical" };
  if (ratio > 0.8) return { ratio, threshold: 200, level: "high" };
  if (ratio >= 0.5) return { ratio, threshold: 500, level: "medium" };
  return { ratio, threshold: 2000, level: "low" };
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

/** Cache: hash → compressed text (avoids re-compressing same content). */
const compressionCache = new Map();

/** Cache: hash → exact original string (preserves identical strings for KV cache warming). */
const sessionCache = new Map();

/** Reset caches (for testing). */
export function _resetCaches() {
  compressionCache.clear();
  sessionCache.clear();
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplicate tool results: if the same content (by hash) appeared in an
 * earlier turn, replace with a back-reference.
 *
 * @param {Array<{id: string, toolName: string, text: string, turnIndex: number}>} results
 * @returns {Map<string, string>} id → replacement text (only for deduped entries)
 */
function dedup(results) {
  const seen = new Map(); // hash → first turnIndex
  const replacements = new Map();

  for (const r of results) {
    const hash = sha256(r.text);
    if (seen.has(hash)) {
      const firstTurn = seen.get(hash);
      if (r.turnIndex > firstTurn) {
        replacements.set(r.id, `[See turn ${firstTurn}, unchanged]`);
      }
    } else {
      seen.set(hash, r.turnIndex);
    }
  }

  return replacements;
}

// ---------------------------------------------------------------------------
// Persist scheduler
// ---------------------------------------------------------------------------

/**
 * Create a debounced persistence scheduler for caches.
 *
 * @param {() => Promise<void>} flushFn - function that writes caches to disk
 * @param {number} intervalMs - debounce interval in ms
 * @returns {{ markDirty: () => void, flush: () => Promise<void>, destroy: () => void }}
 */
export function createPersistScheduler(flushFn, intervalMs = 30_000) {
  let timer = null;
  let dirty = false;

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    dirty = false;
    await flushFn();
  };

  const markDirty = () => {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => flush(), intervalMs);
  };

  const onSignal = () => {
    if (dirty) {
      flush();
    }
  };

  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  const destroy = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
  };

  return { markDirty, flush, destroy };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Compress tool_results in a request body using the 5-step pipeline.
 *
 * @param {object} body - parsed JSON request body
 * @param {object} adapter - provider adapter (extractToolResults, rebuildMessages)
 * @param {object} [config={}] - pipeline configuration
 * @param {number} [config.modelMaxTokens=200000] - model context window
 * @param {boolean} [config.aiEnabled=false] - whether AI compression is enabled
 * @param {Function} [config.compressWithAI] - AI compression function(text, toolName) → string
 * @returns {Promise<{ body: object, stats: object }>}
 */
export async function compressRequest(body, adapter, config = {}) {
  const {
    modelMaxTokens = 200_000,
    aiEnabled = false,
    compressWithAI = null,
  } = config;

  const messages = body.messages || [];

  const stats = {
    originalTokens: 0,
    compressedTokens: 0,
    cacheHits: 0,
    deterministicHits: 0,
    aiHits: 0,
  };

  // Step 1: Extract
  const toolResults = adapter.extractToolResults(messages);
  if (!toolResults || toolResults.length === 0) {
    return { body, stats };
  }

  // Adaptive pressure
  const { threshold } = estimatePressure(messages, modelMaxTokens);

  // Step 2: Dedup
  const dedupMap = dedup(toolResults);

  // Build compressed map: id → compressed text
  const compressedMap = new Map();

  for (const result of toolResults) {
    const originalTokens = countTokens(result.text);
    stats.originalTokens += originalTokens;

    // Deduped?
    if (dedupMap.has(result.id)) {
      const replacement = dedupMap.get(result.id);
      compressedMap.set(result.id, replacement);
      stats.compressedTokens += countTokens(replacement);
      continue;
    }

    // Below threshold? Keep original
    if (originalTokens < threshold) {
      stats.compressedTokens += originalTokens;
      continue;
    }

    const hash = sha256(result.text);

    // Check compression cache
    if (compressionCache.has(hash)) {
      const cached = compressionCache.get(hash);
      compressedMap.set(result.id, cached);
      stats.compressedTokens += countTokens(cached);
      stats.cacheHits += 1;
      continue;
    }

    // Check session cache (exact string reuse for KV warming)
    if (sessionCache.has(hash)) {
      stats.compressedTokens += originalTokens;
      stats.cacheHits += 1;
      continue;
    }

    // Step 3: Deterministic compression
    let compressed = result.text;
    let wasCompressed = false;

    const det = compressDeterministic(result.text, result.toolName);
    if (det.compressed) {
      compressed = det.text;
      wasCompressed = true;
      stats.deterministicHits += 1;
    }

    // Step 4: AI compression (optional)
    const compressedTokens = countTokens(compressed);
    if (
      aiEnabled &&
      compressWithAI &&
      compressedTokens >= threshold &&
      !wasCompressed
    ) {
      try {
        const aiResult = await compressWithAI(compressed, result.toolName);
        if (aiResult && countTokens(aiResult) < compressedTokens) {
          compressed = aiResult;
          stats.aiHits += 1;
        }
      } catch {
        // AI compression failed; keep deterministic result
      }
    }

    if (compressed !== result.text) {
      compressedMap.set(result.id, compressed);
      compressionCache.set(hash, compressed);
      stats.compressedTokens += countTokens(compressed);
    } else {
      // Not compressed — store in session cache for KV warming
      sessionCache.set(hash, result.text);
      stats.compressedTokens += originalTokens;
    }
  }

  // Step 5: Rebuild
  const rebuiltMessages = adapter.rebuildMessages(messages, compressedMap);
  const newBody = { ...body, messages: rebuiltMessages };

  return { body: newBody, stats };
}
