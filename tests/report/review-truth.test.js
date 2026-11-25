// HU-4845 (KJC-TSK-1733, épica KJC-PCS-0113): how truthful the reviews are, in numbers, from the
// verdicts kj already keeps: findings that do not anchor per reviewer, correction rounds before an
// approval, and Solomon's arbitrations by ruling. A verdict from before the anchoring is unmeasured.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { reviewTruth, formatReviewTruth, reviewTruthReport } from "../../src/report/review-truth.js";

const f = (id) => ({ id, severity: "high", category: "correctness", file: "a.js", line: 1, description: "d", suggested_fix: "s" });
const RECORDS = [
  { verdict: "rejected", reviewer: "codex", branch: "b1", timestamp: "2026-11-24T01:00:00Z", issues: [f("a"), f("b")], unanchored: [f("c")] },
  // Saved before the anchoring: no unanchored field, so it is not measured, never counted as anchored.
  { verdict: "rejected", reviewer: "codex", branch: "b1", timestamp: "2026-11-24T01:10:00Z", issues: [f("d")] },
  { verdict: "approved", reviewer: "codex", branch: "b1", timestamp: "2026-11-24T01:20:00Z", issues: [] },
  { verdict: "rejected", reviewer: "agy", branch: "b2", timestamp: "2026-11-24T02:00:00Z", issues: [f("x")], unanchored: [], arbitration: { ruling: "reject" } },
  { verdict: "approved", reviewer: "solomon:agy", branch: "b2", timestamp: "2026-11-24T02:10:00Z", issues: [], arbitration: { ruling: "approve", originalVerdict: { reviewer: "codex" } } },
];

describe("reviewTruth", () => {
  it("counts per reviewer the findings, the unanchored ones and the verdicts it cannot measure", () => {
    const truth = reviewTruth(RECORDS);
    expect(truth.byReviewer.codex).toEqual({ findings: 3, unanchored: 1, unmeasured: 1 });
    expect(truth.byReviewer.agy).toEqual({ findings: 1, unanchored: 0, unmeasured: 0 });
    expect(truth.byReviewer["solomon:agy"]).toBeUndefined();
  });

  it("counts the arbitrations by ruling", () => {
    expect(reviewTruth(RECORDS).arbitrations).toEqual({ total: 2, approve: 1, reject: 1 });
  });

  it("averages the rejections before each approval, per branch", () => {
    // b1: two rejections, then an approval. b2: one rejection, then Solomon's approval.
    expect(reviewTruth(RECORDS).correctionRounds).toEqual({ approvals: 2, mean: 1.5 });
  });

  it("an empty history is zeros, never a division by zero", () => {
    expect(reviewTruth([])).toEqual({ verdicts: 0, byReviewer: {}, arbitrations: { total: 0, approve: 0, reject: 0 }, correctionRounds: { approvals: 0, mean: 0 }, gates: { total: 0, byGate: {} } });
  });
});

describe("formatReviewTruth", () => {
  it("prints one line per reviewer with the share of unanchored findings, the rounds and the arbitrations", () => {
    const text = formatReviewTruth(reviewTruth(RECORDS)).join("\n");
    expect(text).toMatch(/review truth \(5 verdicts\)/);
    expect(text).toMatch(/codex: 3 findings, 1 not anchored \(33%\), 1 verdict\(s\) from before the anchoring not measured/);
    expect(text).toMatch(/agy: 1 findings, 0 not anchored \(0%\)/);
    expect(text).toMatch(/correction rounds: 1\.5 on average over 2 approval\(s\)/);
    expect(text).toMatch(/arbitrations: 2 \(1 approve, 1 reject\)/);
  });
});

describe("formatReviewTruth without findings", () => {
  it("a reviewer with no findings shows 0%, and no unmeasured note when nothing predates the anchoring", () => {
    const text = formatReviewTruth(reviewTruth([RECORDS[2]])).join("\n");
    expect(text).toMatch(/codex: 0 findings, 0 not anchored \(0%\)$/m);
    expect(text).not.toMatch(/not measured/);
  });
});

describe("reviewTruthReport", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-truth-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("reads the verdicts in .karajan/reviews and leaves an unreadable file out", async () => {
    const reviews = path.join(dir, ".karajan", "reviews");
    fs.mkdirSync(reviews, { recursive: true });
    RECORDS.forEach((r, i) => fs.writeFileSync(path.join(reviews, `${i}.json`), JSON.stringify(r)));
    fs.writeFileSync(path.join(reviews, "broken.json"), "{not json");
    expect((await reviewTruthReport({ projectDir: dir })).verdicts).toBe(5);
  });

  it("a project without reviews is an empty report", async () => {
    expect((await reviewTruthReport({ projectDir: dir })).verdicts).toBe(0);
  });
});
