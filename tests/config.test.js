import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyRunOverrides, loadConfig, resolveRole, validateConfig } from "../src/config.js";

const originalCwd = process.cwd();
const originalKjHome = process.env.KJ_HOME;

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalKjHome === undefined) {
    delete process.env.KJ_HOME;
  } else {
    process.env.KJ_HOME = originalKjHome;
  }
});

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

  it("does not leak coderModel override into planner model when plannerModel is not provided", () => {
    const base = {
      coder_options: { model: "legacy-coder-model" },
      roles: {
        planner: { provider: "claude", model: null },
        coder: { provider: "codex", model: null },
        reviewer: { provider: "claude", model: null },
        refactorer: { provider: null, model: null }
      }
    };

    const out = applyRunOverrides(base, {
      coderModel: "code-v2"
    });

    expect(resolveRole(out, "coder").model).toBe("code-v2");
    expect(resolveRole(out, "planner").model).toBe("legacy-coder-model");
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

  it("keeps default budget warning threshold when not overridden", () => {
    const out = applyRunOverrides({}, {});
    expect(out.budget.warn_threshold_pct).toBe(80);
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

describe("loadConfig", () => {
  it("merges budget.pricing overrides from project .karajan.yml", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-config-"));
    const kjHome = path.join(tmpDir, "home");
    await fs.mkdir(kjHome, { recursive: true });
    await fs.writeFile(
      path.join(kjHome, "kj.config.yml"),
      `budget:\n  pricing:\n    codex/o4-mini:\n      input_per_million: 1\n      output_per_million: 2\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(tmpDir, ".karajan.yml"),
      `budget:\n  pricing:\n    codex/o4-mini:\n      output_per_million: 5\n`,
      "utf8"
    );

    process.chdir(tmpDir);
    process.env.KJ_HOME = kjHome;

    const { config } = await loadConfig();
    expect(config.budget.pricing["codex/o4-mini"]).toEqual({
      input_per_million: 1,
      output_per_million: 5
    });
  });
});
