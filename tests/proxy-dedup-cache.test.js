import { describe, expect, it, beforeEach } from "vitest";
import { DedupCache } from "../src/proxy/compression/dedup-cache.js";

/** Generate a string that exceeds 200 tokens (>800 chars). */
const bigContent = (seed = "a") => seed.repeat(900);

/** Generate a string that is <= 200 tokens (<=800 chars). */
/** Generate a string that is exactly 200 tokens (800 chars) — not deduped. */
const smallContent = (seed = "b") => seed.repeat(800);

describe("DedupCache", () => {
  let cache;

  beforeEach(() => {
    cache = new DedupCache();
  });

  it("new content returns isDuplicate false", () => {
    const result = cache.check(bigContent("x"), 1);
    expect(result.isDuplicate).toBe(false);
    expect(result.reference).toBeUndefined();
  });

  it("same content in the same turn returns isDuplicate false", () => {
    cache.check(bigContent("y"), 3);
    const result = cache.check(bigContent("y"), 3);
    expect(result.isDuplicate).toBe(false);
  });

  it("same content in a later turn returns isDuplicate true with reference", () => {
    const text = bigContent("z");
    cache.check(text, 1);
    const result = cache.check(text, 5);

    expect(result.isDuplicate).toBe(true);
    expect(result.reference).toContain("Content from turn 1");
    expect(result.reference).toContain("hash ");
    expect(result.reference).toContain("tokens");
    expect(result.reference).toContain("unchanged");
  });

  it("small content (<= 200 tokens) is never deduped", () => {
    const text = smallContent("s");
    cache.check(text, 1);
    const result = cache.check(text, 5);

    expect(result.isDuplicate).toBe(false);
  });

  describe("LRU eviction", () => {
    it("evicts oldest entry when maxEntries is reached", () => {
      const tiny = new DedupCache({ maxEntries: 2 });

      // Insert 3 entries to force eviction of the first
      tiny.check(bigContent("1"), 1);
      tiny.check(bigContent("2"), 1);
      tiny.check(bigContent("3"), 1); // evicts "1"

      expect(tiny.getStats().entries).toBe(2);

      // "1" was evicted, so checking it in a later turn should be a miss
      const result = tiny.check(bigContent("1"), 2);
      expect(result.isDuplicate).toBe(false);
    });

    it("recently accessed entries survive eviction", () => {
      const tiny = new DedupCache({ maxEntries: 2 });

      tiny.check(bigContent("a"), 1);
      tiny.check(bigContent("b"), 1);

      // Access "a" again (same turn, refreshes LRU position)
      tiny.check(bigContent("a"), 1);

      // Now insert "c" — should evict "b" (oldest), not "a"
      tiny.check(bigContent("c"), 1);

      // "a" should still be in cache
      const resultA = tiny.check(bigContent("a"), 2);
      expect(resultA.isDuplicate).toBe(true);

      // "b" was evicted
      const resultB = tiny.check(bigContent("b"), 3);
      expect(resultB.isDuplicate).toBe(false);
    });
  });

  describe("stats tracking", () => {
    it("tracks totalChecks, hits, and misses", () => {
      const text = bigContent("stat");

      cache.check(text, 1);        // miss
      cache.check(text, 1);        // miss (same turn)
      cache.check(text, 2);        // hit (later turn)
      cache.check(bigContent("other"), 3); // miss (new content)

      const stats = cache.getStats();
      expect(stats.totalChecks).toBe(4);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(3);
      expect(stats.entries).toBe(2);
    });

    it("counts small content checks as misses", () => {
      cache.check(smallContent("t"), 1);
      cache.check(smallContent("t"), 5);

      const stats = cache.getStats();
      expect(stats.totalChecks).toBe(2);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(2);
    });
  });

  describe("reset", () => {
    it("clears cache and stats", () => {
      cache.check(bigContent("r"), 1);
      cache.check(bigContent("r"), 2);
      cache.reset();

      const stats = cache.getStats();
      expect(stats.totalChecks).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.entries).toBe(0);

      // After reset, previously seen content is treated as new
      const result = cache.check(bigContent("r"), 3);
      expect(result.isDuplicate).toBe(false);
    });
  });
});
