import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { makeConfig, noopLogger, reapplyDefaultMocks } from "./fixtures/orchestrator-mocks.js";

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
  getUntrackedFiles: vi.fn().mockResolvedValue([]),
  generateDiff: vi.fn().mockResolvedValue("diff content"),
  setProjectDir: vi.fn()
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

vi.mock("../src/utils/project-detect.js", () => ({
  detectTestFramework: vi.fn().mockResolvedValue({ hasTests: true, framework: "vitest" }),
  detectSonarConfig: vi.fn().mockResolvedValue({ configured: false })
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

describe("dry-run mode", () => {
  let runFlow;

  beforeEach(async () => {
    vi.resetAllMocks();
    await reapplyDefaultMocks("{}");

    const { buildCoderPrompt } = await import("../src/prompts/coder.js");
    buildCoderPrompt.mockReturnValue("coder prompt content");

    const { buildReviewerPrompt } = await import("../src/prompts/reviewer.js");
    buildReviewerPrompt.mockReturnValue("reviewer prompt content");

    const mod = await import("../src/orchestrator.js");
    runFlow = mod.runFlow;
  });

  it("returns dry_run=true without executing agents", async () => {
    const { createAgent } = await import("../src/agents/index.js");

    const config = makeConfig({ reviewer_options: { retries: 0, fallback_reviewer: "codex" } });
    const result = await runFlow({
      task: "Add login",
      config,
      logger: noopLogger,
      flags: { dryRun: true }
    });

    expect(result.dry_run).toBe(true);
    const agent = createAgent.mock.results[0]?.value;
    if (agent) {
      expect(agent.runTask).not.toHaveBeenCalled();
      expect(agent.reviewTask).not.toHaveBeenCalled();
    }
  });

  it("includes resolved roles in dry-run output", async () => {
    const config = makeConfig({ reviewer_options: { retries: 0, fallback_reviewer: "codex" } });
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
    const config = makeConfig({ reviewer_options: { retries: 0, fallback_reviewer: "codex" } });
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
    const config = makeConfig({ reviewer_options: { retries: 0, fallback_reviewer: "codex" } });
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
    const config = makeConfig({ reviewer_options: { retries: 0, fallback_reviewer: "codex" } });
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

    const config = makeConfig({ reviewer_options: { retries: 0, fallback_reviewer: "codex" } });
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

    const config = makeConfig({ reviewer_options: { retries: 0, fallback_reviewer: "codex" } });
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

    const config = makeConfig({ reviewer_options: { retries: 0, fallback_reviewer: "codex" } });
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
