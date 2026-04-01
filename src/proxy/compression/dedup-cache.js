import { createHash } from "node:crypto";

/**
 * Cross-turn content deduplication using an LRU hash cache.
 * Detects repeated content across conversation turns and returns
 * compact references instead of duplicated text.
 */
export class DedupCache {
  #maxEntries;
  #cache; // Map preserves insertion order for LRU
  #totalChecks;
  #hits;
  #misses;

  constructor({ maxEntries = 500 } = {}) {
    this.#maxEntries = maxEntries;
    this.#cache = new Map();
    this.#totalChecks = 0;
    this.#hits = 0;
    this.#misses = 0;
  }

  /**
   * Check if text has been seen in a prior turn.
   * @param {string} text - Content to check
   * @param {number} turnIndex - Current turn number
   * @returns {{isDuplicate: boolean, reference?: string}}
   */
  check(text, turnIndex) {
    this.#totalChecks++;

    const tokenCount = Math.floor(text.length / 4);
    const hash = createHash("sha256").update(text).digest("hex");
    const shortHash = hash.slice(0, 6);

    // Small content is never deduped
    if (tokenCount <= 200) {
      this.#misses++;
      this.#upsert(hash, { hash, turnIndex, tokenCount, insertedAt: Date.now() });
      return { isDuplicate: false };
    }

    const existing = this.#cache.get(hash);

    if (existing && existing.turnIndex < turnIndex) {
      // Seen in a prior turn — duplicate
      this.#hits++;
      // Refresh LRU position
      this.#cache.delete(hash);
      this.#cache.set(hash, { ...existing, insertedAt: Date.now() });
      return {
        isDuplicate: true,
        reference: `[Content from turn ${existing.turnIndex}, hash ${shortHash}, ${tokenCount} tokens - unchanged]`,
      };
    }

    // Not seen or same turn — store and return not duplicate
    this.#misses++;
    this.#upsert(hash, { hash, turnIndex, tokenCount, insertedAt: Date.now() });
    return { isDuplicate: false };
  }

  /**
   * Insert or update an entry, evicting the oldest if at capacity.
   */
  #upsert(key, entry) {
    // If key already exists, delete first to refresh insertion order
    if (this.#cache.has(key)) {
      this.#cache.delete(key);
    }

    // Evict oldest (first inserted) if at capacity
    if (this.#cache.size >= this.#maxEntries) {
      const oldestKey = this.#cache.keys().next().value;
      this.#cache.delete(oldestKey);
    }

    this.#cache.set(key, entry);
  }

  /**
   * @returns {{totalChecks: number, hits: number, misses: number, entries: number}}
   */
  getStats() {
    return {
      totalChecks: this.#totalChecks,
      hits: this.#hits,
      misses: this.#misses,
      entries: this.#cache.size,
    };
  }

  /** Clear all state (call between sessions). */
  reset() {
    this.#cache.clear();
    this.#totalChecks = 0;
    this.#hits = 0;
    this.#misses = 0;
  }
}
