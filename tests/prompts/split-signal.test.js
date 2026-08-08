// KJC-BUG-0138 (issue #1364) — a file split is not a coverage deletion: kj
// precomputes the moved-lines correlation (removed in A, re-added in B in the
// SAME diff) and hands it to the reviewer as its own note — zero LLM.

import { describe, it, expect } from "vitest";
import { buildSplitSignal } from "../../src/prompts/split-signal.js";

const line = (i) => `  expect(computeThing(${i})).toEqual(expected[${i}]);`;

function splitDiff({ moved = 20, kept = 2 } = {}) {
  const movedLines = Array.from({ length: moved }, (_, i) => line(i));
  return [
    "diff --git a/tests/big.test.js b/tests/big.test.js",
    "--- a/tests/big.test.js",
    "+++ b/tests/big.test.js",
    "@@ -1,30 +1,4 @@",
    ...movedLines.map((l) => `-${l}`),
    ...Array.from({ length: kept }, (_, i) => ` ${line(100 + i)}`),
    "diff --git a/tests/extracted.test.js b/tests/extracted.test.js",
    "--- /dev/null",
    "+++ b/tests/extracted.test.js",
    "@@ -0,0 +1,20 @@",
    ...movedLines.map((l) => `+${l}`),
  ].join("\n");
}

describe("buildSplitSignal", () => {
  it("detects removed lines reappearing as additions of another file — and says so as kj", () => {
    const note = buildSplitSignal(splitDiff());
    expect(note).toContain("KJ PIPELINE");
    expect(note).toContain("not from the author");
    expect(note).toContain("tests/big.test.js");
    expect(note).toContain("tests/extracted.test.js (20)");
    expect(note).toMatch(/split|relocation/i);
    expect(note).toMatch(/do not treat moved lines as deleted/i);
  });

  it("returns null for a diff whose removals do not reappear anywhere", () => {
    const diff = [
      "--- a/src/a.js",
      "+++ b/src/a.js",
      "@@ -1,12 +1,1 @@",
      ...Array.from({ length: 12 }, (_, i) => `-  const removedForGood${i} = compute(${i});`),
      "+  const rewritten = computeAll();",
    ].join("\n");
    expect(buildSplitSignal(diff)).toBeNull();
  });

  it("ignores trivial lines — braces and punctuation never fake a move", () => {
    const trivial = ["}", "});", "  };", "", "});"];
    const diff = [
      "--- a/src/a.js",
      "+++ b/src/a.js",
      ...trivial.map((l) => `-${l}`),
      "--- /dev/null",
      "+++ b/src/b.js",
      ...trivial.map((l) => `+${l}`),
    ].join("\n");
    expect(buildSplitSignal(diff)).toBeNull();
  });

  it("stays quiet below the moved-ratio threshold (a rewrite is not a split)", () => {
    const removed = Array.from({ length: 20 }, (_, i) => line(i));
    const diff = [
      "--- a/tests/big.test.js",
      "+++ b/tests/big.test.js",
      ...removed.map((l) => `-${l}`),
      "--- /dev/null",
      "+++ b/tests/new.test.js",
      // only 4 of 20 reappear — most of the removal is a real removal
      ...removed.slice(0, 4).map((l) => `+${l}`),
    ].join("\n");
    expect(buildSplitSignal(diff)).toBeNull();
  });

  it("never matches a line against additions of the SAME file (in-place edits are not moves)", () => {
    const l = line(7);
    const diff = [
      "--- a/src/a.js",
      "+++ b/src/a.js",
      ...Array.from({ length: 12 }, () => `-${l}`),
      ...Array.from({ length: 12 }, () => `+${l}`),
    ].join("\n");
    expect(buildSplitSignal(diff)).toBeNull();
  });

  it("handles null/empty diffs", () => {
    for (const d of [null, ""]) expect(buildSplitSignal(d)).toBeNull();
  });
});
