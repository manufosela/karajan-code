import { describe, expect, it } from "vitest";
import { applyRunOverrides, resolveRole, validateConfig } from "../src/config.js";

describe("applyRunOverrides", () => {
  it("overrides review mode and base branch", () => {
    const base = {
      review_mode: "standard",
      base_branch: "main",
      sonarqube: { enabled: true },
      session: { max_iteration_minutes: 20, max_total_minutes: 120 },
      reviewer_options: { fallback_reviewer: "codex" },
      development: { methodology: "tdd", require_test_changes: true },
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
      branchPrefix: "chore/",
      methodology: "standard"
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
    expect(out.development.methodology).toBe("standard");
    expect(out.development.require_test_changes).toBe(false);
  });

  it("supports role-based provider/model overrides for planner/coder/reviewer/refactorer", () => {
    const base = {
      coder: "claude",
      reviewer: "codex",
      coder_options: { model: "legacy-coder-model", auto_approve: true },
      reviewer_options: { model: "legacy-reviewer-model", fallback_reviewer: "codex" },
      sonarqube: { enabled: true },
      session: { max_iteration_minutes: 20, max_total_minutes: 120 },
      development: { methodology: "tdd", require_test_changes: true },
      git: { auto_commit: false, auto_push: false, auto_pr: false, auto_rebase: true, branch_prefix: "feat/" },
      roles: {
        planner: { provider: "claude", model: "plan-v1" },
        coder: { provider: "claude", model: "code-v1" },
        reviewer: { provider: "codex", model: "review-v1" },
        refactorer: { provider: "gemini", model: "ref-v1" }
      }
    };

    const out = applyRunOverrides(base, {
      planner: "gemini",
      plannerModel: "plan-v2",
      coder: "codex",
      coderModel: "code-v2",
      reviewer: "claude",
      reviewerModel: "review-v2",
      refactorer: "aider",
      refactorerModel: "ref-v2"
    });

    expect(out.roles.planner.provider).toBe("gemini");
    expect(out.roles.planner.model).toBe("plan-v2");
    expect(out.roles.coder.provider).toBe("codex");
    expect(out.roles.coder.model).toBe("code-v2");
    expect(out.roles.reviewer.provider).toBe("claude");
    expect(out.roles.reviewer.model).toBe("review-v2");
    expect(out.roles.refactorer.provider).toBe("aider");
    expect(out.roles.refactorer.model).toBe("ref-v2");
  });

  it("preserves legacy coder/reviewer provider fallback when roles block is absent", () => {
    const base = {
      coder: "gemini",
      reviewer: "aider",
      coder_options: { model: "legacy-coder-model" },
      reviewer_options: { model: "legacy-reviewer-model" }
    };

    const out = applyRunOverrides(base, {});
    expect(resolveRole(out, "coder").provider).toBe("gemini");
    expect(resolveRole(out, "reviewer").provider).toBe("aider");
  });

  it("returns actionable error when required role is not configured", () => {
    const config = {
      review_mode: "standard",
      development: { methodology: "tdd" },
      roles: {
        planner: { provider: null },
        coder: { provider: null },
        reviewer: { provider: "claude" },
        refactorer: { provider: null }
      }
    };

    expect(() => validateConfig(config, "plan")).toThrow(
      "Missing provider for required role 'planner'. Set 'roles.planner.provider' or pass '--planner <name>'"
    );
  });
});
