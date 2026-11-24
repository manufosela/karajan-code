// HU-4837 (KJC-TSK-1731): what kj review --staged prints for a rejection with findings that do not
// anchor: the blocking ones as today, the unanchored ones in a block apart with their reason, and
// for a rejection made only of them, the way on (kj solomon).
import { describe, expect, it } from "vitest";

import { verdictLines } from "../../src/commands/review-gate.js";

const base = { verdict: "rejected", reviewer: "codex", diffHash: "abcdef1234567890" };
const real = { id: "R-1", severity: "high", file: "src/a.js", line: 2, description: "eval runs untrusted code", suggested_fix: "parse it" };
const ghost = { id: "R-2", severity: "medium", file: "src/ghost.js", line: 9, description: "ghost leaks", suggested_fix: "x", reason: "missing-file" };

describe("verdictLines", () => {
  it("prints the blocking findings as today and the unanchored ones apart, each with its reason", () => {
    const text = verdictLines({ ...base, issues: [real], unanchored: [ghost] }).join("\n");
    expect(text).toMatch(/✗ REJECTED by codex — 1 blocking issue\(s\):\n {2}- \(high\) \[src\/a\.js:2\] eval runs untrusted code/);
    expect(text).toMatch(/not anchored[^\n]*\n {2}- \(medium\) \[src\/ghost\.js:9\] ghost leaks — missing-file/);
  });

  it("a rejection made only of unanchored findings says so and names kj solomon", () => {
    const text = verdictLines({ ...base, issues: [], unanchored: [ghost], reason: "unanchored-only" }).join("\n");
    expect(text).toMatch(/0 blocking issue\(s\)/);
    expect(text).toContain("ghost leaks — missing-file");
    expect(text).toMatch(/kj solomon/);
  });

  it("a protected finding that does not anchor is printed as blocking, marked", () => {
    const text = verdictLines({ ...base, issues: [{ ...real, category: "security", unanchored: "missing-line" }] }).join("\n");
    expect(text).toMatch(/- \(high\) \[src\/a\.js:2\] eval runs untrusted code \(not anchored: missing-line\)/);
  });

  it("a rejection without unanchored findings prints no unanchored block", () => {
    const text = verdictLines({ ...base, issues: [real] }).join("\n");
    expect(text).not.toMatch(/not anchored \(kept apart/);
    expect(text).not.toMatch(/kj solomon/);
  });

  it("an approval prints as today", () => {
    const text = verdictLines({ ...base, verdict: "approved", summary: "fine" }).join("\n");
    expect(text).toBe("✓ APPROVED by codex (diff abcdef123456)\n  fine");
  });
});
