// KJC-TSK-0484 PR-B — MMR diversification. The retriever has to balance
// pure relevance against intra-result variety so near-duplicates that
// slipped past the content-hash dedup don't all crowd the topK.
import { describe, it, expect } from "vitest";

import { mmrRerank, cosineSim } from "../../src/rag/retriever.js";

function vec(...nums) { return new Float32Array(nums); }

describe("cosineSim — KJC-TSK-0484 PR-B", () => {
  it("returns 1 for identical vectors and ~0 for orthogonal ones", () => {
    expect(cosineSim(vec(1, 0, 0), vec(1, 0, 0))).toBeCloseTo(1, 5);
    expect(cosineSim(vec(1, 0, 0), vec(0, 1, 0))).toBeCloseTo(0, 5);
  });
  it("safely returns 0 on zero-length or length-mismatch inputs", () => {
    expect(cosineSim(vec(0, 0, 0), vec(0, 0, 0))).toBe(0);
    expect(cosineSim(vec(1, 2), vec(1, 2, 3))).toBe(0);
    expect(cosineSim(null, vec(1, 2))).toBe(0);
  });
});

describe("mmrRerank — KJC-TSK-0484 PR-B", () => {
  it("with lambda=1 collapses to plain relevance order (first topK)", () => {
    const candidates = [
      { id: 1, score: 0.1 },
      { id: 2, score: 0.2 },
      { id: 3, score: 0.3 },
      { id: 4, score: 0.4 },
    ];
    const e = new Map([
      [1, vec(1, 0, 0)], [2, vec(1, 0, 0)], [3, vec(0, 1, 0)], [4, vec(0, 0, 1)],
    ]);
    const picked = mmrRerank(candidates, e, { topK: 3, lambda: 1 });
    expect(picked.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it("with lambda=0 maximises diversity, dropping near-duplicates of the leader", () => {
    const candidates = [
      { id: 1, score: 0.1 }, // anchor
      { id: 2, score: 0.11 }, // near-dup of 1
      { id: 3, score: 0.5 }, // less relevant but orthogonal
      { id: 4, score: 0.6 }, // also orthogonal to 1 and 3
    ];
    const e = new Map([
      [1, vec(1, 0, 0)], [2, vec(0.99, 0.01, 0)], [3, vec(0, 1, 0)], [4, vec(0, 0, 1)],
    ]);
    const picked = mmrRerank(candidates, e, { topK: 3, lambda: 0 });
    expect(picked[0].id).toBe(1);
    expect(picked.map((c) => c.id)).not.toContain(2);
    expect(new Set(picked.map((c) => c.id))).toEqual(new Set([1, 3, 4]));
  });

  it("does not crash when some candidates lack embeddings", () => {
    const candidates = [
      { id: 1, score: 0.1 },
      { id: 2, score: 0.2 },
      { id: 3, score: 0.3 },
    ];
    const e = new Map([[1, vec(1, 0)]]); // 2 and 3 have no embedding
    const picked = mmrRerank(candidates, e, { topK: 2, lambda: 0.5 });
    expect(picked).toHaveLength(2);
    expect(picked[0].id).toBe(1);
  });
});
