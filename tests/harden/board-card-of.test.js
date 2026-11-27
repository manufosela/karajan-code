// HU-4749 (#4733): board-sync reads a card from a branch only when the id leads the slug.
// Two copies of the rule (the hook's boardCardOf, the gate's cardOf in board-pending) share this table.
import { describe, expect, it } from "vitest";
import { boardCardOf } from "../../src/harden/sentinel/sentinel-lib.mjs";
import { blockingMoves } from "../../src/review/board-pending.js";

const ROWS = [
  ["feat/rules-email-hash-required-hu-390", null],
  ["feat/fix-the-login-hu-12", null],
  ["feat/add-2fa-support-123", null],
  ["fix-login-12", null],
  ["chore/release-5.33.0", null],
  ["feat/HU-390-x", "HU-390"],
  ["feat/HU-4746-sonar-layout", "HU-4746"],
  ["feat/KJC-TSK-0123-thing", "KJC-TSK-0123"],
  ["feat/area/HU-12-x", "HU-12"],
];

describe("boardCardOf (hook copy)", () => {
  it.each(ROWS)("%s -> %s", (branch, card) => expect(boardCardOf(branch)).toBe(card));
  it("keeps the split-card capital suffix", () => {
    expect(boardCardOf("feat/XEN-TSK-0815-A-part")).toBe("XEN-TSK-0815-A");
    expect(boardCardOf("feat/XEN-TSK-0815-a-part")).toBe("XEN-TSK-0815");
  });
  it("answers null for empty input", () => expect(boardCardOf("")).toBeNull());
});

describe("cardOf (board-pending copy), seen through an open PR head", () => {
  const carried = (head) => blockingMoves({ pendings: [{ card: "HU-390", pr: 1 }], openPrHeads: [head] }).carried.length === 1;
  it.each(ROWS)("%s -> %s", (branch, card) => expect(carried(branch)).toBe(card === "HU-390"));
  it("a slug that only ends in an id leaves no card to forgive a pending", () => {
    const res = blockingMoves({ pendings: [{ card: "HU-390", pr: 1 }], openPrHeads: ["feat/rules-email-hash-required-hu-390"], openPrNumbers: [2] });
    expect(res.carried).toEqual([]);
    expect(res.blocking).toHaveLength(1);
  });
});
