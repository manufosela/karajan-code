// HU-4901 (KJC-BUG-0663): a rejection kj's own gates sign (sonar, rag-first, mutation...) is
// written to .karajan/reviews with the gate's name as `reviewer`. The review truth block of
// `kj report` counted those as reviewers and as correction rounds. A gate is no reviewer: its
// rejections are counted apart, per gate, and the catalog of gate names follows the code.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GATE_REVIEWERS } from "../../src/review/gate-reviewers.js";
import { formatReviewTruth, reviewTruth } from "../../src/report/review-truth.js";

const ROOT = join(import.meta.dirname, "..", "..");
const f = (id) => ({ id, severity: "high", category: "correctness", file: "a.js", line: 1, description: "d", suggested_fix: "s" });
const RECORDS = [
  { verdict: "rejected", reviewer: "sonar", branch: "b1", timestamp: "2026-11-24T01:00:00Z", issues: [{ severity: "high", description: "s" }] },
  { verdict: "rejected", reviewer: "rag-first", branch: "b1", timestamp: "2026-11-24T01:05:00Z", issues: [{ severity: "high", description: "r" }] },
  { verdict: "rejected", reviewer: "codex", branch: "b1", timestamp: "2026-11-24T01:10:00Z", issues: [f("a")], unanchored: [] },
  { verdict: "approved", reviewer: "codex", branch: "b1", timestamp: "2026-11-24T01:20:00Z", issues: [] },
  { verdict: "rejected", reviewer: "sonar", branch: "b2", timestamp: "2026-11-24T02:00:00Z", issues: [{ severity: "high", description: "s" }] },
];

const sources = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  if (statSync(p).isDirectory()) return sources(p);
  return /\.(m?js)$/.test(name) ? [p] : [];
});

describe("gate rejections are not reviewers (HU-4901)", () => {
  it("a gate is no reviewer row", () => {
    const truth = reviewTruth(RECORDS);
    expect(Object.keys(truth.byReviewer)).toEqual(["codex"]);
    expect(truth.byReviewer.codex).toEqual({ findings: 1, unanchored: 0, unmeasured: 0 });
  });

  it("a gate rejection is no correction round", () => {
    // b1: one rejection by codex, then its approval; the sonar and rag-first rejections do not count.
    expect(reviewTruth(RECORDS).correctionRounds).toEqual({ approvals: 1, mean: 1 });
  });

  it("the gate rejections are counted apart, per gate", () => {
    expect(reviewTruth(RECORDS).gates).toEqual({ total: 3, byGate: { sonar: 2, "rag-first": 1 } });
  });

  it("the block prints the gate rejections on their own line", () => {
    const lines = formatReviewTruth(reviewTruth(RECORDS));
    expect(lines.some((l) => /^\s+sonar:/.test(l))).toBe(false);
    expect(lines).toContain("  gate rejections (not reviewers): 3 (sonar 2, rag-first 1)");
  });

  it("every gate that signs a rejection in src/ is in the catalog", () => {
    const signed = new Set();
    for (const file of sources(join(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/rejected\("([a-z0-9-]+)"/g)) signed.add(m[1]);
      for (const m of text.matchAll(/verdict: "rejected", reviewer: "([a-z0-9-]+)"/g)) signed.add(m[1]);
    }
    expect(signed.size).toBeGreaterThan(5);
    for (const name of signed) expect(GATE_REVIEWERS.has(name), name).toBe(true);
  });

  it("no reviewer of the panel is in the catalog", () => {
    for (const agent of ["claude", "codex", "agy", "gemini", "copilot"]) expect(GATE_REVIEWERS.has(agent)).toBe(false);
  });
});
