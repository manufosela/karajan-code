// KJC-BUG-0545 (#3822): a claim that the diff lacks a change is checked against the whole diff.
import { describe, it, expect, vi } from "vitest";
import { dropFalseAbsences } from "../../src/review/absence-claims.js";
import { thirdPartyReview } from "../../src/review/third-party-review.js";

const diffWith = (line) => [
  "diff --git a/src/a.js b/src/a.js", "@@ -1 +1 @@", "+const a = 1;",
  "diff --git a/src/b.js b/src/b.js", "@@ -1 +1 @@", line, "",
].join("\n");
const claim = (extra = {}) => ({ file: "src/a.js", line: 1, severity: "high", category: "correctness", description: "The diff does not change Foo.toPublicJSON() to add the expose gate", ...extra });

describe("dropFalseAbsences", () => {
  it("drops a claim of absence when another file adds the symbol, naming that file", () => {
    const { kept, dropped } = dropFalseAbsences([claim()], diffWith("+  toPublicJSON() { return gate(this); }"));
    expect(kept).toEqual([]);
    expect(dropped).toEqual([{ finding: claim(), reason: "the diff changes toPublicJSON in src/b.js" }]);
  });

  it("keeps the claim when the symbol is only on a removed or context line", () => {
    for (const line of ["-  toPublicJSON() {}", "   toPublicJSON() {}"]) {
      expect(dropFalseAbsences([claim()], diffWith(line)).kept).toHaveLength(1);
    }
  });

  it("keeps a finding that does not claim absence, even if it names an added symbol", () => {
    const f = claim({ description: "`toPublicJSON` leaks the secret field" });
    expect(dropFalseAbsences([f], diffWith("+toPublicJSON() {}")).kept).toEqual([f]);
  });

  it("never drops a security finding", () => {
    const f = claim({ category: "security" });
    expect(dropFalseAbsences([f], diffWith("+toPublicJSON() {}")).kept).toEqual([f]);
  });

  it("reads a backticked symbol", () => {
    const f = claim({ description: "`exposeGate` is missing from the diff" });
    expect(dropFalseAbsences([f], diffWith("+const exposeGate = true;")).dropped).toHaveLength(1);
  });

  it("drops it when the change is inside the method body, named only by the hunk header", () => {
    const diff = ["diff --git a/src/b.js b/src/b.js", "@@ -10,2 +10,3 @@ class Foo { toPublicJSON() {", "+    if (!this.expose) return {};", ""].join("\n");
    expect(dropFalseAbsences([claim()], diff).dropped).toHaveLength(1);
  });

  it("keeps a claim about missing tests for a symbol the diff adds", () => {
    const f = claim({ description: "The diff does not add tests for `toPublicJSON`" });
    expect(dropFalseAbsences([f], diffWith("+  toPublicJSON() {}")).kept).toEqual([f]);
  });

  it("sees a later absence statement, not only the first one", () => {
    const f = claim({ description: "The diff does not change otherThing. It does not change Foo.toPublicJSON()." });
    expect(dropFalseAbsences([f], diffWith("+  toPublicJSON() {}")).dropped).toHaveLength(1);
  });

  it("returns the positions of the kept findings", () => {
    const keep = claim({ description: "`x` leaks" });
    expect(dropFalseAbsences([claim(), keep], diffWith("+  toPublicJSON() {}")).keptIndices).toEqual([1]);
  });

  it("keeps the claim when only a test file mentions the symbol", () => {
    const diff = ["diff --git a/tests/b.test.js b/tests/b.test.js", "@@ -1 +1 @@", "+expect(foo.toPublicJSON()).toEqual({});", ""].join("\n");
    expect(dropFalseAbsences([claim()], diff).kept).toHaveLength(1);
  });
});

describe("thirdPartyReview with a claim of absence", () => {
  it("drops it, shows it in dropped and the verdict counts only the kept findings", async () => {
    const run = vi.fn().mockResolvedValue({ verdict: "rejected", reviewer: "claude", summary: "s", issues: [claim()], suggestions: [] });
    const none = async () => [];
    const res = await thirdPartyReview({
      range: "main...pr", config: { roles: { reviewer: { provider: "claude" } } }, projectDir: process.cwd(), logger: { info() {} },
      gitDiff: async () => diffWith("+toPublicJSON() {}"), run, requirements: none, security: none, sonar: async () => ({ id: "sonar", ok: true }),
    });
    expect(res.findings).toEqual([]);
    expect(res.dropped).toEqual([{ finding: expect.objectContaining({ file: "src/a.js" }), reason: "the diff changes toPublicJSON in src/b.js" }]);
    expect(res.verdict.summary).not.toMatch(/1 finding/);
  });
});
