import { beforeEach, describe, expect, it, vi } from "vitest";

const REVIEW_BLOCKING = JSON.stringify({
  approved: false,
  blocking_issues: [{ id: "R-1", description: "Fix the failing check" }],
  non_blocking_suggestions: [],
  summary: "Blocking",
  confidence: 0.2
});

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/session-store.js", () => {
  let session = null;
  return {
    createSession: vi.fn(async (initial) => {
      session = {
        id: "s_repeat",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "running",
        checkpoints: [],
        ...initial
      };
      return session;
    }),
    saveSession: vi.fn(async () => {}),
    loadSession: vi.fn(async () => session),
    addCheckpoint: vi.fn(async (s, cp) => {
      s.checkpoints.push({ at: new Date().toISOString(), ...cp });
    }),
    markSessionStatus: vi.fn(async (s, status) => {
      s.status = status;
    }),
    pauseSession: vi.fn(async (s, data) => {
      s.status = "paused";
      s.paused_state = data;
    }),
    resumeSessionWithAnswer: vi.fn(async () => session)
  };
});

vi.mock("../src/review/diff-generator.js", () => ({
  computeBaseRef: vi.fn().mockResolvedValue("abc123"),
  generateDiff: vi.fn().mockResolvedValue("diff content")
}));

vi.mock("../src/review/schema.js", () => ({
  validateReviewResult: vi.fn((r) => r)
}));

vi.mock("../src/review/tdd-policy.js", () => ({
  evaluateTddPolicy: vi.fn().mockReturnValue({
    ok: true,
    reason: "pass",
    sourceFiles: ["a.js"],
    testFiles: ["a.test.js"],
    message: "OK"
  })
}));

vi.mock("../src/prompts/coder.js", () => ({
  buildCoderPrompt: vi.fn().mockReturnValue("coder prompt")
}));

vi.mock("../src/prompts/reviewer.js", () => ({
  buildReviewerPrompt: vi.fn().mockReturnValue("reviewer prompt")
}));

vi.mock("../src/orchestrator/solomon-escalation.js", () => ({
  invokeSolomon: vi.fn().mockResolvedValue({ action: "pause", question: "Reviewer stalled" })
}));

vi.mock("../src/sonar/api.js", () => ({
  getQualityGateStatus: vi.fn(),
  getOpenIssues: vi.fn()
}));

vi.mock("../src/sonar/scanner.js", () => ({
  runSonarScan: vi.fn()
}));

vi.mock("../src/sonar/enforcer.js", () => ({
  shouldBlockByProfile: vi.fn(),
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
    readFile: vi.fn().mockResolvedValue("review rules"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
  }
}));

describe("orchestrator repeat detection", () => {
  let runFlow;

  beforeEach(async () => {
    vi.resetAllMocks();

    const { createAgent } = await import("../src/agents/index.js");
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: "" })
    });

    const { evaluateTddPolicy } = await import("../src/review/tdd-policy.js");
    evaluateTddPolicy.mockReturnValue({
      ok: true,
      reason: "pass",
      sourceFiles: ["a.js"],
      testFiles: ["a.test.js"],
      message: "OK"
    });

    const { computeBaseRef, generateDiff } = await import("../src/review/diff-generator.js");
    computeBaseRef.mockResolvedValue("abc123");
    generateDiff.mockResolvedValue("diff content");

    const { validateReviewResult } = await import("../src/review/schema.js");
    validateReviewResult.mockImplementation((r) => r);

    const { shouldBlockByProfile, summarizeIssues } = await import("../src/sonar/enforcer.js");
    shouldBlockByProfile.mockReturnValue(false);
    summarizeIssues.mockReturnValue("");

    const fs = await import("node:fs/promises");
    fs.default.readFile.mockResolvedValue("review rules");

    const { invokeSolomon } = await import("../src/orchestrator/solomon-escalation.js");
    invokeSolomon.mockResolvedValue({ action: "pause", question: "Reviewer stalled" });

    const mod = await import("../src/orchestrator.js");
    runFlow = mod.runFlow;
  });

  it("stalls when SonarQube issues repeat consecutively", async () => {
    const { createAgent } = await import("../src/agents/index.js");
    const coderAgent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }) };
    const reviewerAgent = { reviewTask: vi.fn().mockResolvedValue({ ok: true, output: "" }) };
    createAgent.mockImplementation((name) => (name === "codex" ? coderAgent : reviewerAgent));

    const { runSonarScan } = await import("../src/sonar/scanner.js");
    runSonarScan.mockResolvedValue({ ok: true, projectKey: "proj-key" });

    const { getQualityGateStatus, getOpenIssues } = await import("../src/sonar/api.js");
    getQualityGateStatus.mockResolvedValue({ status: "ERROR" });
    getOpenIssues.mockResolvedValue({
      total: 1,
      issues: [{ rule: "rule-1", message: "Issue A" }]
    });

    const { shouldBlockByProfile } = await import("../src/sonar/enforcer.js");
    shouldBlockByProfile.mockReturnValue(true);

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setContext: vi.fn(),
      resetContext: vi.fn()
    };

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 3,
      review_rules: "./review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: true, host: "http://localhost:9000" },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2, repeat_detection_threshold: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const result = await runFlow({ task: "repeat sonar", config, logger, flags: {} });

    const { markSessionStatus } = await import("../src/session-store.js");
    expect(markSessionStatus).toHaveBeenCalledWith(expect.any(Object), "stalled");
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("stalled");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("SonarQube issues repeated"));
    expect(getOpenIssues).toHaveBeenCalledTimes(2);
  });

  it("stalls when reviewer blocking issues repeat consecutively", async () => {
    const { createAgent } = await import("../src/agents/index.js");
    const coderAgent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }) };
    const reviewerAgent = { reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_BLOCKING }) };
    createAgent.mockImplementation((name) => (name === "codex" ? coderAgent : reviewerAgent));

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setContext: vi.fn(),
      resetContext: vi.fn()
    };

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 3,
      review_rules: "./review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: false },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2, repeat_detection_threshold: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const result = await runFlow({ task: "repeat reviewer", config, logger, flags: {} });

    const { markSessionStatus } = await import("../src/session-store.js");
    expect(markSessionStatus).toHaveBeenCalledWith(expect.any(Object), "stalled");
    expect(result.paused).toBe(true);
    expect(result.context).toBe("reviewer_stalled");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Reviewer stalled"));
    expect(reviewerAgent.reviewTask).toHaveBeenCalledTimes(2);
  });
});
