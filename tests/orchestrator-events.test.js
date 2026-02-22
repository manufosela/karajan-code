import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const REVIEW_OK = JSON.stringify({
  approved: true,
  blocking_issues: [],
  non_blocking_suggestions: [],
  summary: "OK",
  confidence: 0.9
});

// Mock all external dependencies
vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn(() => ({
    runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
    reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_OK })
  }))
}));

vi.mock("../src/session-store.js", () => {
  let session = null;
  return {
    createSession: vi.fn(async (initial) => {
      session = {
        id: "s_test",
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

vi.mock("../src/sonar/api.js", () => ({
  getQualityGateStatus: vi.fn().mockResolvedValue({ status: "OK" }),
  getOpenIssues: vi.fn().mockResolvedValue({ total: 0, issues: [] })
}));

vi.mock("../src/sonar/scanner.js", () => ({
  runSonarScan: vi.fn().mockResolvedValue({ ok: true })
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
    readFile: vi.fn().mockResolvedValue("review rules"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
  }
}));

describe("orchestrator events", () => {
  let runFlow;

  beforeEach(async () => {
    vi.resetAllMocks();

    // Re-apply default mocks after reset
    const { createAgent } = await import("../src/agents/index.js");
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_OK })
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

    const { buildCoderPrompt } = await import("../src/prompts/coder.js");
    buildCoderPrompt.mockReturnValue("coder prompt");

    const { buildReviewerPrompt } = await import("../src/prompts/reviewer.js");
    buildReviewerPrompt.mockReturnValue("reviewer prompt");

    const fs = await import("node:fs/promises");
    fs.default.readFile.mockResolvedValue("review rules");

    const mod = await import("../src/orchestrator.js");
    runFlow = mod.runFlow;
  });

  it("emits progress events in correct sequence for approved flow", async () => {
    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e.type));

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 1,
      review_rules: "./review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: false },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      setContext: vi.fn(), resetContext: vi.fn()
    };

    const result = await runFlow({
      task: "test task",
      config,
      logger,
      flags: {},
      emitter
    });

    expect(result.approved).toBe(true);
    expect(events).toEqual([
      "session:start",
      "iteration:start",
      "coder:start",
      "coder:end",
      "tdd:result",
      "reviewer:start",
      "reviewer:end",
      "iteration:end",
      "session:end"
    ]);
  });

  it("emits events with correct schema", async () => {
    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e));

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 1,
      review_rules: "./review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: false },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      setContext: vi.fn(), resetContext: vi.fn()
    };

    await runFlow({ task: "test", config, logger, flags: {}, emitter });

    for (const event of events) {
      expect(event).toHaveProperty("type");
      expect(event).toHaveProperty("sessionId");
      expect(event).toHaveProperty("timestamp");
      expect(event).toHaveProperty("message");
      expect(event).toHaveProperty("elapsed");
      expect(typeof event.elapsed).toBe("number");
    }
  });

  it("runs sonar scan before reviewer when SonarQube is enabled", async () => {
    const { createAgent } = await import("../src/agents/index.js");
    const coderAgent = {
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" })
    };
    const reviewerAgent = {
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_OK })
    };
    createAgent.mockImplementation((name) => {
      if (name === "codex") return coderAgent;
      return reviewerAgent;
    });

    const { runSonarScan } = await import("../src/sonar/scanner.js");
    runSonarScan.mockResolvedValue({ ok: true, projectKey: "kj-repo-123", stdout: "scan ok", stderr: "" });
    const { getQualityGateStatus, getOpenIssues } = await import("../src/sonar/api.js");
    getQualityGateStatus.mockResolvedValue({ status: "OK" });
    getOpenIssues.mockResolvedValue({ total: 0, issues: [] });

    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e.type));

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 1,
      review_rules: "./review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: true, host: "http://localhost:9000" },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      setContext: vi.fn(), resetContext: vi.fn()
    };

    const result = await runFlow({ task: "test", config, logger, flags: {}, emitter });

    expect(result.approved).toBe(true);
    expect(runSonarScan).toHaveBeenCalledTimes(1);
    expect(getQualityGateStatus).toHaveBeenCalledWith(config, "kj-repo-123");
    expect(getOpenIssues).toHaveBeenCalledWith(config, "kj-repo-123");
    expect(runSonarScan.mock.invocationCallOrder[0]).toBeLessThan(reviewerAgent.reviewTask.mock.invocationCallOrder[0]);

    expect(events).toContain("sonar:start");
    expect(events).toContain("sonar:end");
    expect(events).toContain("reviewer:start");
    expect(events.indexOf("sonar:start")).toBeLessThan(events.indexOf("sonar:end"));
    expect(events.indexOf("sonar:end")).toBeLessThan(events.indexOf("reviewer:start"));
  });

  it("emits agent:output events from coder and reviewer", async () => {
    const { createAgent } = await import("../src/agents/index.js");
    createAgent.mockReturnValue({
      runTask: vi.fn().mockImplementation(async (task) => {
        if (task.onOutput) {
          task.onOutput({ stream: "stdout", line: "coder line 1" });
          task.onOutput({ stream: "stdout", line: "coder line 2" });
        }
        return { ok: true, output: "" };
      }),
      reviewTask: vi.fn().mockImplementation(async (task) => {
        if (task.onOutput) {
          task.onOutput({ stream: "stdout", line: "reviewer line 1" });
        }
        return { ok: true, output: REVIEW_OK };
      })
    });

    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e));

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 1,
      review_rules: "./review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: false },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      setContext: vi.fn(), resetContext: vi.fn()
    };

    await runFlow({ task: "test", config, logger, flags: {}, emitter });

    const outputEvents = events.filter((e) => e.type === "agent:output");
    expect(outputEvents.length).toBe(3);
    expect(outputEvents[0].message).toBe("coder line 1");
    expect(outputEvents[0].detail.agent).toBe("codex");
    expect(outputEvents[0].stage).toBe("coder");
    expect(outputEvents[2].message).toBe("reviewer line 1");
    expect(outputEvents[2].detail.agent).toBe("claude");
    expect(outputEvents[2].stage).toBe("reviewer");
  });

  it("calls askQuestion on fail-fast and continues if answer provided", async () => {
    const { evaluateTddPolicy } = await import("../src/review/tdd-policy.js");
    let tddCallCount = 0;
    evaluateTddPolicy.mockImplementation(() => {
      tddCallCount += 1;
      if (tddCallCount <= 2) {
        return { ok: false, reason: "no tests", sourceFiles: ["a.js"], testFiles: [], message: "No tests found" };
      }
      return { ok: true, reason: "pass", sourceFiles: ["a.js"], testFiles: ["a.test.js"], message: "OK" };
    });

    const askQuestion = vi.fn().mockResolvedValue("Skip tests for now");

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 5,
      review_rules: "./review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: false },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      setContext: vi.fn(), resetContext: vi.fn()
    };

    const emitter = new EventEmitter();
    const result = await runFlow({ task: "test", config, logger, flags: {}, emitter, askQuestion });

    expect(askQuestion).toHaveBeenCalledTimes(1);
    expect(askQuestion.mock.calls[0][0]).toContain("TDD policy has failed");
    expect(result.approved).toBe(true);
  });

  it("falls back to pause when askQuestion returns null", async () => {
    const { evaluateTddPolicy } = await import("../src/review/tdd-policy.js");
    evaluateTddPolicy.mockReturnValue({
      ok: false, reason: "no tests", sourceFiles: ["a.js"], testFiles: [], message: "No tests found"
    });

    const askQuestion = vi.fn().mockResolvedValue(null);

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 5,
      review_rules: "./review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: false },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      setContext: vi.fn(), resetContext: vi.fn()
    };

    const emitter = new EventEmitter();
    const result = await runFlow({ task: "test", config, logger, flags: {}, emitter, askQuestion });

    expect(askQuestion).toHaveBeenCalledTimes(1);
    expect(result.paused).toBe(true);
  });

  it("works without emitter (backward compatible)", async () => {
    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 1,
      review_rules: "./review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: false },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      setContext: vi.fn(), resetContext: vi.fn()
    };

    // Should not throw even without emitter
    const result = await runFlow({ task: "test", config, logger, flags: {} });
    expect(result.approved).toBe(true);
  });

  it("runs planner and refactorer stages when enabled in pipeline", async () => {
    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e.type));

    const { createAgent } = await import("../src/agents/index.js");
    const runTask = vi.fn().mockResolvedValue({ ok: true, output: "ok" });
    createAgent.mockReturnValue({
      runTask,
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_OK })
    });

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 1,
      review_rules: "./review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: false },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" },
      roles: {
        planner: { provider: "gemini", model: "plan-model" },
        coder: { provider: "codex", model: "code-model" },
        reviewer: { provider: "claude", model: "review-model" },
        refactorer: { provider: "aider", model: "refactor-model" }
      },
      pipeline: {
        planner: { enabled: true },
        refactorer: { enabled: true }
      }
    };

    const logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      setContext: vi.fn(), resetContext: vi.fn()
    };

    const result = await runFlow({
      task: "test task",
      config,
      logger,
      flags: {},
      emitter
    });

    expect(result.approved).toBe(true);
    expect(events).toEqual([
      "session:start",
      "planner:start",
      "planner:end",
      "iteration:start",
      "coder:start",
      "coder:end",
      "refactorer:start",
      "refactorer:end",
      "tdd:result",
      "reviewer:start",
      "reviewer:end",
      "iteration:end",
      "session:end"
    ]);
    expect(runTask).toHaveBeenCalledWith(expect.objectContaining({ role: "planner" }));
    expect(runTask).toHaveBeenCalledWith(expect.objectContaining({ role: "coder" }));
    expect(runTask).toHaveBeenCalledWith(expect.objectContaining({ role: "refactorer" }));
  });
});
