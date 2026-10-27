// KJC-TSK-1247 (#2623): two reviewers of different families review the same range on their own,
// each one's findings verified by the other; kj reconciles them into one result.
import { describe, expect, it } from "vitest";
import { applyVerification } from "../../src/review/finding-verifier.js";
import { reconcileReviews } from "../../src/review/dual-review.js";

const f = (file, line, severity, description, category = null) => ({ file, line, severity, category, description, suggested_fix: null });
const coverage = { files: { total: 2, reviewed: 2 }, truncated: false };
// One side: its reviewer's findings after the other family's verdicts on them.
const side = (reviewer, verifier, approved, findings, verdicts) => ({
  reviewer, model: null, coverage,
  verdict: { status: approved ? "approved" : "rejected", approved, summary: `${reviewer} summary` },
  ...applyVerification(findings, verdicts, { verifier }),
});

describe("reconcileReviews", () => {
  it("merges a finding both found, ranks it first and says who found and verified it", () => {
    const claude = side("claude", "codex", false, [f("a.js", 10, "medium", "style"), f("b.js", 5, "high", "null deref")],
      [{ index: 0, verdict: "confirmed" }, { index: 1, verdict: "confirmed" }]);
    const codex = side("codex", "claude", false, [f("b.js", 7, "high", "may be null")], [{ index: 0, verdict: "confirmed" }]);
    const out = reconcileReviews([claude, codex]);
    expect(out.findings[0]).toMatchObject({ file: "b.js", found_by: ["claude", "codex"], verification: { codex: "confirmed", claude: "confirmed" } });
    expect(out.findings[1]).toMatchObject({ file: "a.js", found_by: ["claude"], verification: { codex: "confirmed" } });
    expect(out.reviewers.map((r) => r.reviewer)).toEqual(["claude", "codex"]);
    expect(out.verdict).toMatchObject({ status: "rejected", approved: false });
    expect(out.verdict.reason).toMatch(/b\.js:5/);
  });

  it("lists the rejected findings apart, with who found and who rejected them", () => {
    const claude = side("claude", "codex", false, [f("a.js", 1, "high", "bogus")], [{ index: 0, verdict: "rejected", reason: "not real" }]);
    const codex = side("codex", "claude", true, [], []);
    const out = reconcileReviews([claude, codex]);
    expect(out.findings).toEqual([]);
    expect(out.verification.rejected).toEqual([{ finding: f("a.js", 1, "high", "bogus"), reason: "not real", found_by: "claude", rejected_by: "codex" }]);
    expect(out.verdict.status).toBe("partial");
    expect(out.verdict.reason).toMatch(/claude rejected/);
  });

  it("approves only when both approve and no confirmed blocker remains", () => {
    const clean = reconcileReviews([side("claude", "codex", true, [f("a.js", 1, "low", "nit")], [{ index: 0, verdict: "confirmed" }]), side("codex", "claude", true, [], [])]);
    expect(clean.verdict).toMatchObject({ status: "approved", approved: true });
    // An unverified blocker is not a confirmed one: both approved, so approved (#2623 point 4).
    const unverified = reconcileReviews([side("claude", "codex", true, [f("a.js", 1, "high", "risk")], []), side("codex", "claude", true, [], [])]);
    expect(unverified.verdict.status).toBe("approved");
    const truncated = reconcileReviews([{ ...side("claude", "codex", true, [], []), coverage: { ...coverage, truncated: true } }, side("codex", "claude", true, [], [])]);
    expect(truncated.verdict).toMatchObject({ status: "partial", reason: expect.stringMatching(/not every file/) });
  });

  it("a security finding is a confirmed blocker whatever the verifier says", () => {
    const claude = side("claude", "codex", false, [f("a.js", 1, "medium", "sqli", "security")], [{ index: 0, verdict: "rejected" }]);
    const out = reconcileReviews([claude, side("codex", "claude", true, [], [])]);
    expect(out.findings[0]).toMatchObject({ category: "security", verification: { codex: "kept_by_rule" } });
    expect(out.verdict.status).toBe("rejected");
  });
});
