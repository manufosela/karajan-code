import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/session-store.js", () => ({
  createSession: vi.fn(async (initial) => ({
    id: "s_dry", status: "running", checkpoints: [], ...initial
  })),
  saveSession: vi.fn(async () => {}),
  loadSession: vi.fn(async () => null),
  addCheckpoint: vi.fn(async () => {}),
  markSessionStatus: vi.fn(async () => {}),
  pauseSession: vi.fn(async () => {}),
  resumeSessionWithAnswer: vi.fn(async () => null)
}));

vi.mock("../src/review/diff-generator.js", () => ({
  computeBaseRef: vi.fn().mockResolvedValue("abc123"),
  generateDiff: vi.fn().mockResolvedValue("diff content")
}));

vi.mock("../src/review/schema.js", () => ({
  validateReviewResult: vi.fn((r) => r)
}));

vi.mock("../src/review/tdd-policy.js", () => ({
  evaluateTddPolicy: vi.fn().mockReturnValue({ ok: true })
}));

vi.mock("../src/prompts/coder.js", () => ({
  buildCoderPrompt: vi.fn().mockReturnValue("coder prompt content")
}));

vi.mock("../src/prompts/reviewer.js", () => ({
  buildReviewerPrompt: vi.fn().mockReturnValue("reviewer prompt content")
}));

vi.mock("../src/sonar/api.js", () => ({
  getQualityGateStatus: vi.fn().mockResolvedValue({ status: "OK" }),
  getOpenIssues: vi.fn().mockResolvedValue({ total: 0, issues: [] })
}));

vi.mock("../src/sonar/scanner.js", () => ({
  runSonarScan: vi.fn().mockResolvedValue({ ok: true, projectKey: "test-key" })
}));

vi.mock("../src/sonar/enforcer.js", () => ({
  shouldBlockByProfile: vi.fn().mockReturnValue(false),
  summarizeIssues: vi.fn().mockReturnValue("")
}));

vi.mock("../src/utils/git.js", () => ({
  ensureGitRepo: vi.fn().mockResolvedValue(true),
  currentBranch: vi.fn().mockResolvedValue("feat/test"),
  fetchBase: vi.fn(),
  syncBaseBranch: vi.fn(),
  ensureBranchUpToDateWithBase: vi.fn(),
  createBranch: vi.fn(),
  buildBranchName: vi.fn().mockReturnValue("feat/test"),
  commitAll: vi.fn().mockResolvedValue({ committed: true }),
  pushBranch: vi.fn(),
  createPullRequest: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockResolvedValue("role instructions"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
  }
}));

function makeConfig(overrides = {}) {
  return {
    coder: "codex",
    reviewer: "claude",
    review_mode: "standard",
    max_iterations: 5,
    base_branch: "main",
    roles: {
      planner: { provider: null },
      coder: { provider: "codex" },
      reviewer: { provider: "claude" },
      refactorer: { provider: null }
    },
    pipeline: { planner: { enabled: false }, refactorer: { enabled: false }, solomon: { enabled: false } },
    coder_options: { auto_approve: true },
    reviewer_options: { retries: 0, fallback_reviewer: "codex" },
    development: { methodology: "tdd", require_test_changes: true },
    sonarqube: { enabled: true, host: "http://localhost:9000", enforcement_profile: "pragmatic" },
    git: { auto_commit: false, auto_push: false, auto_pr: false },
    session: {
      max_iteration_minutes: 15,
      max_total_minutes: 120,
      fail_fast_repeats: 2,
      repeat_detection_threshold: 2,
      max_sonar_retries: 3,
      max_reviewer_retries: 3
    },
    failFast: { repeatThreshold: 2 },
    output: { log_level: "error" },
    ...overrides
  };
}

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn() };

describe("dry-run mode", () => {
  let runFlow;

  beforeEach(async () => {
    vi.resetAllMocks();

    const { createAgent } = await import("../src/agents/index.js");
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: "{}" })
    });

    const { computeBaseRef } = await import("../src/review/diff-generator.js");
    computeBaseRef.mockResolvedValue("abc123");

    const { buildCoderPrompt } = await import("../src/prompts/coder.js");
    buildCoderPrompt.mockReturnValue("coder prompt content");

    const { buildReviewerPrompt } = await import("../src/prompts/reviewer.js");
    buildReviewerPrompt.mockReturnValue("reviewer prompt content");

    const fs = await import("node:fs/promises");
    fs.default.readFile.mockResolvedValue("role instructions");

    const mod = await import("../src/orchestrator.js");
    runFlow = mod.runFlow;
  });

  it("returns dry_run=true without executing agents", async () => {
    const { createAgent } = await import("../src/agents/index.js");

    const config = makeConfig();
    const result = await runFlow({
      task: "Add login",
      config,
      logger: noopLogger,
      flags: { dryRun: true }
    });

    expect(result.dry_run).toBe(true);
    // Agents should never be called
    const agent = createAgent.mock.results[0]?.value;
    if (agent) {
      expect(agent.runTask).not.toHaveBeenCalled();
      expect(agent.reviewTask).not.toHaveBeenCalled();
    }
  });

  it("includes resolved roles in dry-run output", async () => {
    const config = makeConfig();
    const result = await runFlow({
      task: "Add login",
      config,
      logger: noopLogger,
      flags: { dryRun: true }
    });

    expect(result.roles.coder.provider).toBe("codex");
    expect(result.roles.reviewer.provider).toBe("claude");
  });

  it("includes pipeline configuration", async () => {
    const config = makeConfig();
    const result = await runFlow({
      task: "Add login",
      config,
      logger: noopLogger,
      flags: { dryRun: true }
    });

    expect(result.pipeline).toBeDefined();
    expect(result.pipeline.planner_enabled).toBe(false);
    expect(result.pipeline.refactorer_enabled).toBe(false);
    expect(result.pipeline.sonar_enabled).toBe(true);
  });

  it("includes session limits", async () => {
    const config = makeConfig();
    const result = await runFlow({
      task: "Add login",
      config,
      logger: noopLogger,
      flags: { dryRun: true }
    });

    expect(result.limits.max_iterations).toBe(5);
    expect(result.limits.max_total_minutes).toBe(120);
  });

  it("includes sample prompts", async () => {
    const config = makeConfig();
    const result = await runFlow({
      task: "Add login",
      config,
      logger: noopLogger,
      flags: { dryRun: true }
    });

    expect(result.prompts.coder).toBeTruthy();
    expect(result.prompts.reviewer).toBeTruthy();
  });

  it("does not create a session store entry", async () => {
    const { createSession } = await import("../src/session-store.js");

    const config = makeConfig();
    await runFlow({
      task: "Add login",
      config,
      logger: noopLogger,
      flags: { dryRun: true }
    });

    expect(createSession).not.toHaveBeenCalled();
  });

  it("does not run sonar scan", async () => {
    const { runSonarScan } = await import("../src/sonar/scanner.js");

    const config = makeConfig();
    await runFlow({
      task: "Add login",
      config,
      logger: noopLogger,
      flags: { dryRun: true }
    });

    expect(runSonarScan).not.toHaveBeenCalled();
  });

  it("emits a dry-run progress event", async () => {
    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e));

    const config = makeConfig();
    await runFlow({
      task: "Add login",
      config,
      logger: noopLogger,
      flags: { dryRun: true },
      emitter
    });

    const dryRunEvent = events.find((e) => e.type === "dry-run:summary");
    expect(dryRunEvent).toBeTruthy();
  });
});
