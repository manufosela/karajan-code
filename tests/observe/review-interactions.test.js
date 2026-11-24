// HU-4865 (KJC-TSK-1769): coder, reviewer and Solomon interactions counted from the kept verdicts.
import { describe, expect, it } from "vitest";
import { reviewInteractions } from "../../src/observe/review-interactions.js";
import { reviewTruth } from "../../src/report/review-truth.js";

const verdict = (over) => ({
  verdict: "approved", reviewer: "codex", host: "claude", branch: "feat/a", issues: [],
  timestamp: "2026-11-24T10:00:00.000Z", summary: "secret summary of src/a.js", diffHash: "abc123", ...over,
});

const records = [
  verdict({ verdict: "rejected", issues: [{ id: "f1" }], unanchored: [{ id: "u1" }], timestamp: "2026-11-24T10:00:00.000Z" }),
  verdict({ verdict: "rejected", issues: [{ id: "f2" }], unanchored: [], timestamp: "2026-11-24T10:05:00.000Z" }),
  verdict({ timestamp: "2026-11-24T10:10:00.000Z" }),
  verdict({ reviewer: "agy", branch: "feat/b", timestamp: "2026-11-24T11:00:00.000Z" }),
  verdict({ reviewer: "solomon:agy", verdict: "approved", arbitration: { ruling: "approve" }, branch: "feat/c", timestamp: "2026-11-24T12:00:00.000Z" }),
  verdict({ reviewer: "solomon:agy", verdict: "rejected", arbitration: { ruling: "reject" }, branch: "feat/d", timestamp: "2026-11-24T12:30:00.000Z" }),
];

describe("reviewInteractions (HU-4865)", () => {
  it("gives one row per author and reviewer pair with verdicts, rounds, rejections, unanchored and arbitrations", () => {
    expect(reviewInteractions(records)).toEqual([
      { author: "claude", reviewer: "agy", verdicts: 1, approvals: 1, rejections: 0, findings: 0, unanchored: 0,
        correctionRounds: { approvals: 1, mean: 0 }, arbitrations: { total: 0, approve: 0, reject: 0 } },
      { author: "claude", reviewer: "codex", verdicts: 3, approvals: 1, rejections: 2, findings: 3, unanchored: 1,
        correctionRounds: { approvals: 1, mean: 2 }, arbitrations: { total: 0, approve: 0, reject: 0 } },
      { author: "claude", reviewer: "solomon:agy", verdicts: 2, approvals: 1, rejections: 1, findings: 0, unanchored: 0,
        correctionRounds: { approvals: 1, mean: 0 }, arbitrations: { total: 2, approve: 1, reject: 1 } },
    ]);
  });

  it("takes rounds, findings and arbitrations from reviewTruth, not from a second calculation", () => {
    const codex = records.filter((r) => r.reviewer === "codex");
    const truth = reviewTruth(codex);
    const [row] = reviewInteractions(codex);
    expect(row.correctionRounds).toEqual(truth.correctionRounds);
    expect(row.arbitrations).toEqual(truth.arbitrations);
    expect(row.findings).toBe(truth.byReviewer.codex.findings);
    expect(row.unanchored).toBe(truth.byReviewer.codex.unanchored);
  });

  it("never lets a summary, a hash, a branch or an odd name out", () => {
    const rows = reviewInteractions([verdict({ reviewer: "codex; rm -rf /home/x", host: "claude" }), verdict({ host: undefined })]);
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/secret|abc123|feat\/a|\/home\//);
    expect(rows.map((r) => `${r.author}>${r.reviewer}`)).toEqual(["claude>other", "unknown>codex"]);
  });

  it("returns no rows for no verdicts", () => {
    expect(reviewInteractions([])).toEqual([]);
  });
});
