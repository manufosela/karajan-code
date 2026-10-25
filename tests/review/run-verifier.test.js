// KJC-TSK-1195 (#2369, part 2): kj review --third-party --verifier runs the finding
// verifier of another family and returns the verified findings and a verification block.
import { describe, it, expect, vi } from "vitest";
import { familyOf, parseVerdicts, assertCrossFamily, verifyFindings } from "../../src/review/run-verifier.js";
import { thirdPartyReview } from "../../src/review/third-party-review.js";

const DIFF = "diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1,2 @@\n a\n+eval(i)\n";
const findings = [{ file: "x.js", line: 2, severity: "high", category: "correctness", description: "d", suggested_fix: null }];

describe("familyOf", () => {
  it("the model names the family when it is recognised, the CLI otherwise", () => {
    expect([familyOf("claude"), familyOf("codex"), familyOf("agy")]).toEqual(["claude", "codex", "gemini"]);
    expect([familyOf("copilot", "claude-opus-5-5"), familyOf("copilot", "gpt-6"), familyOf("copilot")]).toEqual(["claude", "codex", null]);
  });
});

describe("parseVerdicts", () => {
  it("reads the JSON array even wrapped in prose or a fence; anything else is no verdicts", () => {
    expect(parseVerdicts("ok:\n```json\n[{\"index\":0,\"verdict\":\"confirmed\"}]\n```")).toEqual([{ index: 0, verdict: "confirmed" }]);
    expect(parseVerdicts("they look fine")).toEqual([]);
    expect(parseVerdicts("[not json]")).toEqual([]);
  });
});

describe("assertCrossFamily", () => {
  it("refuses a verifier of the reviewer's family, by CLI or by model; warns when a family is unknown", () => {
    expect(() => assertCrossFamily({ reviewer: "claude", verifier: "claude" })).toThrow(/same family/);
    expect(() => assertCrossFamily({ reviewer: "claude", verifier: "copilot", verifierModel: "claude-sonnet-5" })).toThrow(/same family/);
    const warn = vi.fn();
    assertCrossFamily({ reviewer: "claude", verifier: "codex", logger: { warn } });
    assertCrossFamily({ reviewer: "claude", verifier: "opencode", logger: { warn } });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("verifyFindings", () => {
  it("asks the verifier once, with its model as the reviewer role's, and applies the answer", async () => {
    const reviewTask = vi.fn().mockResolvedValue({ ok: true, output: "[{\"index\":0,\"verdict\":\"rejected\",\"reason\":\"no\"}]" });
    const createAgentFn = vi.fn(() => ({ reviewTask }));
    const out = await verifyFindings({ findings, diff: DIFF, verifier: "codex", model: "gpt-6", config: {}, createAgentFn });
    expect(createAgentFn).toHaveBeenCalledWith("codex", expect.objectContaining({ roles: { reviewer: { provider: "codex", model: "gpt-6" } } }), undefined);
    expect(reviewTask).toHaveBeenCalledTimes(1);
    expect(out.findings).toEqual([]);
    expect(out.verification).toMatchObject({ verifier: "codex", model: "gpt-6", rejected: [{ finding: findings[0], reason: "no" }] });
  });

  it("a verifier that fails leaves every finding unverified and says why", async () => {
    const createAgentFn = () => ({ reviewTask: async () => ({ ok: false, error: "quota" }) });
    const out = await verifyFindings({ findings, diff: DIFF, verifier: "codex", config: {}, createAgentFn });
    expect(out.findings).toEqual(findings);
    expect(out.verification).toMatchObject({ unverified: 1, error: "quota" });
  });
});

describe("thirdPartyReview --verifier", () => {
  const base = {
    range: "main...pr", config: { roles: { reviewer: { provider: "claude" } } }, projectDir: "/p", logger: { info() {}, warn() {} },
    gitDiff: async () => DIFF, requirements: async () => [], security: async () => [], sonar: async () => ({ id: "sonar", ok: true }),
    run: async () => ({ verdict: "rejected", reviewer: "claude", summary: "s", issues: [{ ...findings[0] }], suggestions: [] }),
  };

  it("without a verifier the findings keep their category and there is no verification block", async () => {
    const res = await thirdPartyReview(base);
    expect(res.findings).toEqual(findings);
    expect(res).not.toHaveProperty("verification");
  });

  it("with a verifier the findings are the verified ones and the block travels in the document", async () => {
    const verify = vi.fn(async () => ({ findings: [], verification: { verifier: "codex", rejected: [{ finding: findings[0], reason: "no" }] } }));
    const res = await thirdPartyReview({ ...base, verifier: "codex", verify });
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ findings, diff: DIFF, verifier: "codex" }));
    expect(res.findings).toEqual([]);
    expect(res.verification.rejected).toHaveLength(1);
  });

  it("refuses a verifier of the reviewer's own family before spending a token", async () => {
    const verify = vi.fn();
    await expect(thirdPartyReview({ ...base, verifier: "claude", verify })).rejects.toThrow(/same family/);
    expect(verify).not.toHaveBeenCalled();
  });
});
