import { describe, expect, it } from "vitest";
import { applyRunOverrides } from "../src/config.js";

describe("applyRunOverrides", () => {
  it("overrides review mode and base branch", () => {
    const base = {
      review_mode: "standard",
      base_branch: "main",
      sonarqube: { enabled: true },
      session: { max_iteration_minutes: 20, max_total_minutes: 120 },
      reviewer_options: { fallback_reviewer: "codex" },
      git: { auto_commit: false, auto_push: false, auto_pr: false, auto_rebase: true, branch_prefix: "feat/" }
    };

    const out = applyRunOverrides(base, {
      mode: "paranoid",
      baseBranch: "develop",
      noSonar: true,
      maxIterationMinutes: 1,
      maxTotalMinutes: 15,
      reviewerFallback: "gemini",
      reviewerRetries: 0,
      autoCommit: true,
      autoPush: true,
      autoPr: true,
      autoRebase: false,
      branchPrefix: "chore/"
    });

    expect(out.review_mode).toBe("paranoid");
    expect(out.base_branch).toBe("develop");
    expect(out.sonarqube.enabled).toBe(false);
    expect(out.session.max_iteration_minutes).toBe(1);
    expect(out.session.max_total_minutes).toBe(15);
    expect(out.reviewer_options.fallback_reviewer).toBe("gemini");
    expect(out.reviewer_options.retries).toBe(0);
    expect(out.git.auto_commit).toBe(true);
    expect(out.git.auto_push).toBe(true);
    expect(out.git.auto_pr).toBe(true);
    expect(out.git.auto_rebase).toBe(false);
    expect(out.git.branch_prefix).toBe("chore/");
  });
});
