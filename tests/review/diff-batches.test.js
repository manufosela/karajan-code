// KJC-BUG-0378 (#2263): a large PR was reviewed only up to the reviewer's clip.
// The diff is split by file and grouped into batches that fit, and what does not
// fit is counted, so the review can say what it covered.
import { describe, it, expect } from "vitest";
import { batchDiff, splitByFile, MAX_REVIEW_BATCHES } from "../../src/review/diff-batches.js";

const fileDiff = (name, changed) => [
  `diff --git a/${name} b/${name}`, `--- a/${name}`, `+++ b/${name}`, "@@ -1,1 +1,1 @@",
  ...Array.from({ length: changed }, (_, i) => `+line ${i}`),
].join("\n");

describe("splitByFile", () => {
  it("cuts the diff at each file and counts its changed lines", () => {
    const parts = splitByFile(`${fileDiff("a.js", 2)}\n${fileDiff("b.js", 3)}`);
    expect(parts.map((p) => [p.file, p.changed])).toEqual([["a.js", 2], ["b.js", 3]]);
    expect(parts[1].text.startsWith("diff --git a/b.js")).toBe(true);
  });
});

describe("batchDiff", () => {
  it("packs whole files into batches under the limit, in order", () => {
    const diff = [fileDiff("a.js", 3), fileDiff("b.js", 3), fileDiff("c.js", 3)].join("\n");
    const { batches, coverage } = batchDiff(diff, { limit: fileDiff("a.js", 3).length * 2 + 2, maxBatches: 5 });
    expect(batches.map((b) => b.files)).toEqual([["a.js", "b.js"], ["c.js"]]);
    expect(coverage).toEqual({ files: { reviewed: 3, total: 3 }, lines: { reviewed: 9, total: 9 }, truncated: false, unreviewed: [] });
  });

  // KJC-BUG-0382 (#2263): one file too large for a batch was left out whole.
  it("splits a file too large for one batch by hunks, repeating its header in each piece", () => {
    const hunk = (n) => [`@@ -${n},1 +${n},2 @@`, ...Array.from({ length: 4 }, (_, i) => `+h${n} line ${i}`)].join("\n");
    const head = ["diff --git a/big.js b/big.js", "--- a/big.js", "+++ b/big.js"].join("\n");
    const big = [head, hunk(1), hunk(20), hunk(40)].join("\n");
    const { batches, coverage } = batchDiff(big, { limit: `${head}\n${hunk(1)}`.length + 10, maxBatches: 5 });
    expect(batches).toHaveLength(3);
    for (const [i, n] of [1, 20, 40].entries()) {
      expect(batches[i].text.startsWith("diff --git a/big.js")).toBe(true);
      expect(batches[i].text).toContain(`@@ -${n},1`);
      expect(batches[i].files).toEqual(["big.js"]);
    }
    expect(coverage).toEqual({ files: { reviewed: 1, total: 1 }, lines: { reviewed: 12, total: 12 }, truncated: false, unreviewed: [] });
  });

  // KJC-BUG-0384 (#2263): a new file is one hunk; when it did not fit a batch it was left out.
  it("splits a hunk too large for one batch by lines, each piece with correct line numbers", () => {
    const head = ["diff --git a/New.java b/New.java", "new file mode 100644", "--- /dev/null", "+++ b/New.java"].join("\n");
    const body = Array.from({ length: 300 }, (_, i) => `+line ${String(i + 1).padStart(3, "0")}`);
    const diff = [head, "@@ -0,0 +1,300 @@", ...body].join("\n");
    const { batches, coverage } = batchDiff(diff, { limit: head.length + 30 + 100 * 9, maxBatches: 10 });
    expect(batches.length).toBeGreaterThan(2);
    expect(coverage).toMatchObject({ files: { reviewed: 1, total: 1 }, lines: { reviewed: 300, total: 300 }, truncated: false });
    let next = 1;
    for (const b of batches) {
      const lines = b.text.split("\n");
      expect(lines.slice(0, 4).join("\n")).toBe(head);
      const [, start, count] = /^@@ -0,0 \+(\d+),(\d+) @@/.exec(lines[4]);
      expect(Number(start)).toBe(next);
      expect(lines[5]).toBe(`+line ${String(next).padStart(3, "0")}`);
      next += Number(count);
    }
    expect(next).toBe(301);
  });

  it("never emits a batch over the limit: a single line too large is left out and named", () => {
    const head = ["diff --git a/min.js b/min.js", "--- /dev/null", "+++ b/min.js"].join("\n");
    const limit = 400;
    const diff = [head, "@@ -0,0 +1,3 @@ function veryLongContextSignature(withArguments, andMore)", "+small", `+${"x".repeat(limit)}`, "+tail"].join("\n");
    const { batches, coverage } = batchDiff(diff, { limit, maxBatches: 10 });
    for (const b of batches) expect(b.text.length).toBeLessThanOrEqual(limit);
    expect(coverage).toMatchObject({ truncated: true, unreviewed: ["min.js"], lines: { reviewed: 2, total: 3 } });
  });

  // HU-4976 (#4947): the big file's pieces filled the cap and the 2-line file after it was left out.
  it("packs the files that fit whole first, so the cap never leaves them out behind a cut file", () => {
    const diff = `${fileDiff("data.json", 600)}\n${fileDiff("state.json", 2)}`;
    const { batches, coverage } = batchDiff(diff, { limit: 400, maxBatches: MAX_REVIEW_BATCHES });
    expect(batches).toHaveLength(MAX_REVIEW_BATCHES);
    expect(batches[0].files).toContain("state.json");
    expect(coverage.unreviewed).toEqual(["data.json"]);
    expect(coverage.unreviewedReasons).toEqual({ "data.json": "batch-cap" });
  });

  it("says a file with a line no prompt can hold is too large", () => {
    const diff = ["diff --git a/min.js b/min.js", "--- /dev/null", "+++ b/min.js", "@@ -0,0 +1 @@", `+${"x".repeat(400)}`].join("\n");
    const { coverage } = batchDiff(diff, { limit: 400, maxBatches: 10 });
    expect(coverage.unreviewedReasons).toEqual({ "min.js": "too-large" });
  });

  it("leaves out a file larger than the limit, and files past the batch cap, and says which", () => {
    const small = fileDiff("a.js", 2);
    const diff = [small, fileDiff("huge.js", 500), fileDiff("b.js", 2), fileDiff("c.js", 2)].join("\n");
    const { batches, coverage } = batchDiff(diff, { limit: small.length + 1, maxBatches: 2 });
    expect(batches.map((b) => b.files)).toEqual([["a.js"], ["b.js"]]);
    expect(coverage).toMatchObject({ files: { reviewed: 2, total: 4 }, lines: { reviewed: 4, total: 506 }, truncated: true, unreviewed: ["huge.js", "c.js"] });
  });
});
