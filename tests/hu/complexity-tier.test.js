// KJC-TSK-0698 (MR-A): every HU leaves the decomposition with its tier and why:
// the decomposing model's judgement (same answer, no extra call) and a
// deterministic signal; the higher one wins, and sensitive zones are always deep.
import { describe, it, expect } from "vitest";
import { deterministicTier, huComplexity } from "../../src/hu/complexity-tier.js";

const hu = (over = {}) => ({ title: "Rename a label", goal: "rename the button label", acceptanceCriteria: ["the label reads Save"], ...over });

describe("deterministicTier", () => {
  it("a sensitive zone (security, migrations, supervisor) is deep, naming the zone", () => {
    expect(deterministicTier(hu({ goal: "migrate the board database to node:sqlite" }))).toEqual({ tier: "deep", reason: "sensitive zone: migrat" });
    expect(deterministicTier(hu({ acceptanceCriteria: ["the auth token is rotated"] })).tier).toBe("deep");
    expect(deterministicTier(hu({ title: "Sentinel supervisor guard" })).tier).toBe("deep");
  });

  it("three or more criteria are standard; fewer, trivial", () => {
    expect(deterministicTier(hu({ acceptanceCriteria: ["a", "b", "c"] }))).toEqual({ tier: "standard", reason: "3 acceptance criteria" });
    expect(deterministicTier(hu()).tier).toBe("trivial");
  });
});

describe("huComplexity", () => {
  it("judgement and signal agree: the tier with both reasons", () => {
    expect(huComplexity(hu({ tier: "trivial", tierReason: "one label" }))).toMatchObject({ tier: "trivial", judged: "trivial", signal: "trivial" });
  });

  it("they disagree: the higher one wins and the record says why", () => {
    const c = huComplexity(hu({ tier: "trivial", tierReason: "small", goal: "rotate the secret keys" }));
    expect(c).toMatchObject({ tier: "deep", judged: "trivial", signal: "deep" });
    expect(c.reason).toMatch(/signal deep \(sensitive zone: secret\) over judged trivial \(small\)/);
    expect(huComplexity(hu({ tier: "deep", tierReason: "touches three modules" }))).toMatchObject({ tier: "deep", reason: expect.stringMatching(/judged deep \(touches three modules\) over signal trivial/) });
  });

  it("no judgement from the model (old prompt, odd value): the signal alone, said so", () => {
    expect(huComplexity(hu({ tier: "huge" }))).toMatchObject({ tier: "trivial", judged: null, reason: expect.stringMatching(/no judged tier/) });
  });
});
