import { describe, expect, it } from "vitest";
import { applyRunOverrides } from "../src/config.js";

describe("applyRunOverrides", () => {
  it("overrides review mode and base branch", () => {
    const base = {
      review_mode: "standard",
      base_branch: "main",
      sonarqube: { enabled: true },
      session: { max_iteration_minutes: 20, max_total_minutes: 120 }
    };

    const out = applyRunOverrides(base, {
      mode: "paranoid",
      baseBranch: "develop",
      noSonar: true,
      maxIterationMinutes: 1,
      maxTotalMinutes: 15
    });

    expect(out.review_mode).toBe("paranoid");
    expect(out.base_branch).toBe("develop");
    expect(out.sonarqube.enabled).toBe(false);
    expect(out.session.max_iteration_minutes).toBe(1);
    expect(out.session.max_total_minutes).toBe(15);
  });
});
