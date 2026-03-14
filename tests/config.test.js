import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyRunOverrides, loadConfig, loadProjectConfig, getProjectConfigPath, resolveRole, validateConfig } from "../src/config.js";

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

  it("applies enableArchitect and architectModel overrides", () => {
    const base = {
      roles: {
        architect: { provider: null, model: null }
      },
      pipeline: {
        architect: { enabled: false }
      }
    };

    const out = applyRunOverrides(base, {
      enableArchitect: true,
      architectModel: "o3-pro"
    });

    expect(out.pipeline.architect.enabled).toBe(true);
    expect(out.roles.architect.model).toBe("o3-pro");
  });

  it("applies architect provider override", () => {
    const base = {};
    const out = applyRunOverrides(base, { architect: "gemini" });
    expect(out.roles.architect.provider).toBe("gemini");
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

describe("DEFAULTS pipeline", () => {
  it("has architect disabled by default", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-defaults-arch-"));
    const kjHome = path.join(tmpDir, "home");
    await fs.mkdir(kjHome, { recursive: true });

    process.chdir(tmpDir);
    process.env.KJ_HOME = kjHome;

    const { config } = await loadConfig();
    expect(config.pipeline.architect.enabled).toBe(false);
    expect(config.roles.architect.model).toBeNull();
  });

  it("has guards with sensible defaults", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-defaults-guards-"));
    const kjHome = path.join(tmpDir, "home");
    await fs.mkdir(kjHome, { recursive: true });

    process.chdir(tmpDir);
    process.env.KJ_HOME = kjHome;

    const { config } = await loadConfig();
    expect(config.guards.output.enabled).toBe(true);
    expect(config.guards.output.on_violation).toBe("block");
    expect(config.guards.output.patterns).toEqual([]);
    expect(config.guards.output.protected_files).toEqual([]);
    expect(config.guards.perf.enabled).toBe(true);
    expect(config.guards.perf.block_on_warning).toBe(false);
    expect(config.guards.intent.enabled).toBe(false);
    expect(config.guards.intent.confidence_threshold).toBe(0.85);
  });

  it("merges custom guards config over defaults", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-guards-merge-"));
    const kjHome = path.join(tmpDir, "home");
    await fs.mkdir(kjHome, { recursive: true });
    await fs.writeFile(
      path.join(kjHome, "kj.config.yml"),
      `guards:\n  output:\n    protected_files:\n      - secrets.yml\n  perf:\n    block_on_warning: true\n  intent:\n    enabled: true\n`,
      "utf8"
    );

    process.chdir(tmpDir);
    process.env.KJ_HOME = kjHome;

    const { config } = await loadConfig();
    expect(config.guards.output.enabled).toBe(true);
    expect(config.guards.output.protected_files).toEqual(["secrets.yml"]);
    expect(config.guards.perf.block_on_warning).toBe(true);
    expect(config.guards.intent.enabled).toBe(true);
  });

  it("has intent guard disabled by default with confidence threshold", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-defaults-intent-"));
    const kjHome = path.join(tmpDir, "home");
    await fs.mkdir(kjHome, { recursive: true });

    process.chdir(tmpDir);
    process.env.KJ_HOME = kjHome;

    const { config } = await loadConfig();
    expect(config.guards.intent.enabled).toBe(false);
    expect(config.guards.intent.confidence_threshold).toBe(0.85);
    expect(config.guards.intent.patterns).toEqual([]);
  });

  it("has tester and security enabled by default", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-defaults-"));
    const kjHome = path.join(tmpDir, "home");
    await fs.mkdir(kjHome, { recursive: true });

    process.chdir(tmpDir);
    process.env.KJ_HOME = kjHome;

    const { config } = await loadConfig();
    expect(config.pipeline.tester.enabled).toBe(true);
    expect(config.pipeline.security.enabled).toBe(true);
  });
});

describe("loadConfig", () => {
  it("merges project config (.karajan/kj.config.yml) over global config", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-projcfg-"));
    const kjHome = path.join(tmpDir, "home");
    await fs.mkdir(kjHome, { recursive: true });
    await fs.writeFile(
      path.join(kjHome, "kj.config.yml"),
      `coder: claude\nroles:\n  coder:\n    provider: claude\n  reviewer:\n    provider: codex\n`,
      "utf8"
    );
    const karajanDir = path.join(tmpDir, ".karajan");
    await fs.mkdir(karajanDir, { recursive: true });
    await fs.writeFile(
      path.join(karajanDir, "kj.config.yml"),
      `roles:\n  coder:\n    provider: gemini\n`,
      "utf8"
    );

    process.chdir(tmpDir);
    process.env.KJ_HOME = kjHome;

    const { config, hasProjectConfig } = await loadConfig();
    expect(hasProjectConfig).toBe(true);
    expect(config.roles.coder.provider).toBe("gemini");
    expect(config.roles.reviewer.provider).toBe("codex");
  });

  it("uses global config only when no project config exists", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-noproj-"));
    const kjHome = path.join(tmpDir, "home");
    await fs.mkdir(kjHome, { recursive: true });
    await fs.writeFile(
      path.join(kjHome, "kj.config.yml"),
      `roles:\n  coder:\n    provider: claude\n`,
      "utf8"
    );

    process.chdir(tmpDir);
    process.env.KJ_HOME = kjHome;

    const { config, hasProjectConfig } = await loadConfig();
    expect(hasProjectConfig).toBe(false);
    expect(config.roles.coder.provider).toBe("claude");
  });

  it("project config roles override global roles while preserving unset fields", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-rolemerge-"));
    const kjHome = path.join(tmpDir, "home");
    await fs.mkdir(kjHome, { recursive: true });
    await fs.writeFile(
      path.join(kjHome, "kj.config.yml"),
      `roles:\n  coder:\n    provider: claude\n    model: opus\n  reviewer:\n    provider: codex\n    model: o4-mini\nmax_iterations: 10\n`,
      "utf8"
    );
    const karajanDir = path.join(tmpDir, ".karajan");
    await fs.mkdir(karajanDir, { recursive: true });
    await fs.writeFile(
      path.join(karajanDir, "kj.config.yml"),
      `roles:\n  coder:\n    provider: gemini\nmax_iterations: 3\n`,
      "utf8"
    );

    process.chdir(tmpDir);
    process.env.KJ_HOME = kjHome;

    const { config } = await loadConfig();
    // Project overrides coder provider
    expect(config.roles.coder.provider).toBe("gemini");
    // Global coder model preserved (deep merge)
    expect(config.roles.coder.model).toBe("opus");
    // Reviewer untouched
    expect(config.roles.reviewer.provider).toBe("codex");
    expect(config.roles.reviewer.model).toBe("o4-mini");
    // Scalar override
    expect(config.max_iterations).toBe(3);
  });

  it("loadProjectConfig returns null when .karajan/kj.config.yml is missing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-noprojcfg-"));
    process.chdir(tmpDir);
    const result = await loadProjectConfig(tmpDir);
    expect(result).toBeNull();
  });

  it("getProjectConfigPath points to .karajan/kj.config.yml in given dir", () => {
    const p = getProjectConfigPath("/foo/bar");
    expect(p).toBe(path.join("/foo/bar", ".karajan", "kj.config.yml"));
  });

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
