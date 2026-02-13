import { describe, expect, it } from "vitest";
import { applyRunOverrides } from "../src/config.js";

describe("applyRunOverrides", () => {
  it("overrides review mode and base branch", () => {
    const base = {
      review_mode: "standard",
      base_branch: "main",
      sonarqube: { enabled: true }
    };

    const out = applyRunOverrides(base, {
      mode: "paranoid",
      baseBranch: "develop",
      noSonar: true
    });

    expect(out.review_mode).toBe("paranoid");
    expect(out.base_branch).toBe("develop");
    expect(out.sonarqube.enabled).toBe(false);
  });
});
