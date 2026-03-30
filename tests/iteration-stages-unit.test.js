import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module-level mocks ---

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn(() => ({
    runTask: vi.fn(async () => ({ ok: true, output: "agent output" })),
    reviewTask: vi.fn(async () => ({ ok: true, output: "review output" }))
  }))
}));

vi.mock("../src/roles/coder-role.js", () => ({
  CoderRole: vi.fn()
}));

vi.mock("../src/roles/refactorer-role.js", () => ({
  RefactorerRole: vi.fn()
}));

let sonarRunFn;

vi.mock("../src/roles/sonar-role.js", () => ({
  SonarRole: class {
    constructor() {
      this.init = vi.fn(async () => {});
      this.run = (...args) => sonarRunFn(...args);
    }
  }
}));

vi.mock("../src/session-store.js", () => ({
  addCheckpoint: vi.fn(async () => {}),
  markSessionStatus: vi.fn(async () => {}),
  saveSession: vi.fn(async () => {})
}));

vi.mock("../src/review/diff-generator.js", () => ({
  generateDiff: vi.fn(async () => "diff --git a/src/foo.js b/src/foo.js\n+new line\n"),
  getUntrackedFiles: vi.fn(async () => [])
}));

vi.mock("../src/review/tdd-policy.js", () => ({
  evaluateTddPolicy: vi.fn(() => ({
    ok: true,
    reason: "tests_present",
    sourceFiles: ["src/foo.js"],
    testFiles: ["tests/foo.test.js"]
  }))
}));

vi.mock("../src/review/schema.js", () => ({
  validateReviewResult: vi.fn((r) => r)
}));

vi.mock("../src/review/scope-filter.js", () => ({
  filterReviewScope: vi.fn((review) => ({
    review, demoted: [], deferred: [], allDemoted: false
  })),
  buildDeferredContext: vi.fn(() => null)
}));

vi.mock("../src/utils/events.js", () => ({
  emitProgress: vi.fn(),
  makeEvent: vi.fn((type, base, data) => ({ type, ...base, ...data }))
}));

vi.mock("../src/orchestrator/reviewer-fallback.js", () => ({
  runReviewerWithFallback: vi.fn(async () => ({
    execResult: {
      ok: true,
      result: {
        approved: true,
        blocking_issues: [],
        non_blocking_suggestions: [],
        raw_summary: "All good",
        confidence: 0.9
      }
    },
    attempts: [{ reviewer: "codex", result: { ok: true } }]
  }))
}));

vi.mock("../src/orchestrator/agent-fallback.js", () => ({
  runCoderWithFallback: vi.fn(async () => ({
    execResult: { ok: true },
    attempts: [{ coder: "claude", result: { ok: true } }]
  }))
}));

vi.mock("../src/orchestrator/solomon-escalation.js", () => ({
  invokeSolomon: vi.fn(async () => ({ action: "continue" }))
}));

vi.mock("../src/utils/rate-limit-detector.js", () => ({
  detectRateLimit: vi.fn(() => ({ isRateLimit: false }))
}));

vi.mock("../src/sonar/manager.js", () => ({
  sonarUp: vi.fn(async () => ({ exitCode: 0 })),
  isSonarReachable: vi.fn(async () => true)
}));

vi.mock("../src/utils/stall-detector.js", () => ({
  createStallDetector: vi.fn(() => ({
    onOutput: vi.fn(),
    stop: vi.fn(),
    stats: () => ({ lineCount: 0, bytesReceived: 0, elapsedMs: 0 })
  }))
}));

vi.mock("../src/utils/injection-guard.js", () => ({
  scanDiff: vi.fn(() => ({ clean: true, findings: [], summary: "" }))
}));

// --- Helpers ---

function resetSonarRunFn() {
  sonarRunFn = vi.fn(async () => ({
    ok: true,
    summary: "Quality gate OK",
    result: { gateStatus: "OK", openIssuesTotal: 0, projectKey: "test-project" }
  }));
}

function makeSession(overrides = {}) {
  return {
    id: "session-001",
    task: "implement feature X",
    session_start_sha: "abc123",
    last_reviewer_feedback: null,
    last_sonar_summary: null,
    repeated_issue_count: 0,
    sonar_retry_count: 0,
    checkpoints: [],
    deferred_issues: [],
    resolved_policies: null,
    ...overrides
  };
}

function makeConfig(overrides = {}) {
  return {
    output: { log_level: "error" },
    roles: { coder: { provider: "claude" }, reviewer: { provider: "codex" } },
    pipeline: { sonar: { enabled: false }, solomon: { enabled: false } },
    session: { max_iteration_minutes: 5, fail_fast_repeats: 3, max_sonar_retries: 2 },
    development: { methodology: "tdd", test_patterns: [".test."], source_extensions: [".js"] },
    base_branch: "main",
    sonarqube: { host: "http://localhost:9000" },
    review_mode: "standard",
    ...overrides
  };
}

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
const emitter = { emit: vi.fn() };
const eventBase = { sessionId: "session-001", iteration: 1, startedAt: Date.now() };
const coderRole = { provider: "claude", model: null };
const reviewerRole = { provider: "codex", model: null };
const trackBudget = vi.fn();
const budgetSummary = vi.fn(() => ({}));
const repeatDetector = {
  addIteration: vi.fn(),
  isStalled: vi.fn(() => ({ stalled: false })),
  getRepeatCounts: vi.fn(() => ({ reviewer: 0, sonar: 0 }))
};

// --- Tests ---

describe("iteration-stages: runCoderStage", () => {
  let runCoderStage;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetSonarRunFn();
    ({ runCoderStage } = await import("../src/orchestrator/iteration-stages.js"));
  });

  it("calls coder role execute and returns undefined on success", async () => {
    const executeMock = vi.fn(async () => ({
      ok: true,
      result: { output: "done" },
      summary: "Coder completed"
    }));
    const coderRoleInstance = { execute: executeMock };

    const result = await runCoderStage({
      coderRoleInstance, coderRole, config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), plannedTask: "do X", trackBudget, iteration: 1
    });

    expect(executeMock).toHaveBeenCalled();
    expect(result).toBeUndefined(); // success returns void
    expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({ role: "coder" }));
  });

  it("throws when coder fails (non-rate-limit)", async () => {
    const executeMock = vi.fn(async () => ({
      ok: false,
      result: { error: "syntax error" },
      summary: "Coder failed"
    }));
    const coderRoleInstance = { execute: executeMock };

    await expect(
      runCoderStage({
        coderRoleInstance, coderRole, config: makeConfig(), logger, emitter, eventBase,
        session: makeSession(), plannedTask: "do X", trackBudget, iteration: 1
      })
    ).rejects.toThrow(/coder failed/i);
  });

  it("returns standby action on rate limit", async () => {
    const { detectRateLimit } = await import("../src/utils/rate-limit-detector.js");
    detectRateLimit.mockReturnValueOnce({ isRateLimit: true, cooldownMs: 60000, message: "rate limited" });

    const executeMock = vi.fn(async () => ({
      ok: false,
      result: { error: "rate limited", output: "" },
      summary: "rate limit"
    }));
    const coderRoleInstance = { execute: executeMock };

    const result = await runCoderStage({
      coderRoleInstance, coderRole, config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), plannedTask: "do X", trackBudget, iteration: 1
    });

    expect(result.action).toBe("standby");
    expect(result.standbyInfo.cooldownMs).toBe(60000);
  });
});

describe("iteration-stages: runSonarStage", () => {
  let runSonarStage;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetSonarRunFn();
    ({ runSonarStage } = await import("../src/orchestrator/iteration-stages.js"));
  });

  it("runs scan and returns ok when gate passes", async () => {
    const sonarState = { issuesInitial: null, issuesFinal: null };
    const result = await runSonarStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), trackBudget, iteration: 1,
      repeatDetector, budgetSummary, sonarState, askQuestion: null, task: "do X"
    });

    expect(result.action).toBe("ok");
    expect(result.stageResult.gateStatus).toBe("OK");
  });

  it("skips when sonar is not reachable and docker start fails", async () => {
    const { isSonarReachable, sonarUp } = await import("../src/sonar/manager.js");
    isSonarReachable.mockResolvedValueOnce(false);
    sonarUp.mockResolvedValueOnce({ exitCode: 1, stderr: "docker not found" });

    const sonarState = { issuesInitial: null, issuesFinal: null };
    const result = await runSonarStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), trackBudget, iteration: 1,
      repeatDetector, budgetSummary, sonarState, askQuestion: null, task: "do X"
    });

    expect(result.action).toBe("ok");
    expect(result.stageResult.gateStatus).toBe("SKIPPED");
  });

  it("throws on sonar scan error without gate status", async () => {
    sonarRunFn = vi.fn(async () => ({
      ok: false,
      summary: "Sonar error",
      result: { error: "connection refused" }
    }));

    const sonarState = { issuesInitial: null, issuesFinal: null };
    await expect(
      runSonarStage({
        config: makeConfig(), logger, emitter, eventBase,
        session: makeSession(), trackBudget, iteration: 1,
        repeatDetector, budgetSummary, sonarState, askQuestion: null, task: "do X"
      })
    ).rejects.toThrow(/sonar scan failed/i);
  });
});

describe("iteration-stages: runReviewerStage", () => {
  let runReviewerStage;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetSonarRunFn();
    ({ runReviewerStage } = await import("../src/orchestrator/iteration-stages.js"));
  });

  it("returns approved review on success", async () => {
    const result = await runReviewerStage({
      reviewerRole, config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), trackBudget, iteration: 1,
      reviewRules: "rules", task: "do X", repeatDetector, budgetSummary, askQuestion: null
    });

    expect(result.review.approved).toBe(true);
  });

  it("returns rejected review when reviewer rejects", async () => {
    const { runReviewerWithFallback } = await import("../src/orchestrator/reviewer-fallback.js");
    runReviewerWithFallback.mockResolvedValueOnce({
      execResult: {
        ok: true,
        result: {
          approved: false,
          blocking_issues: [{ id: "BUG-1", severity: "high", description: "missing null check" }],
          non_blocking_suggestions: [],
          raw_summary: "Issues found",
          confidence: 0.8
        }
      },
      attempts: [{ reviewer: "codex", result: { ok: true } }]
    });

    const result = await runReviewerStage({
      reviewerRole, config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), trackBudget, iteration: 1,
      reviewRules: "rules", task: "do X", repeatDetector, budgetSummary, askQuestion: null
    });

    expect(result.review.approved).toBe(false);
    expect(result.review.blocking_issues).toHaveLength(1);
  });

  it("handles parse error in reviewer output", async () => {
    const { runReviewerWithFallback } = await import("../src/orchestrator/reviewer-fallback.js");
    runReviewerWithFallback.mockResolvedValueOnce({
      execResult: {
        ok: true,
        result: {
          approved: false,
          blocking_issues: [],
          non_blocking_suggestions: [],
          raw_summary: ""
        }
      },
      attempts: [{ reviewer: "codex", result: { ok: true } }]
    });

    const { validateReviewResult } = await import("../src/review/schema.js");
    validateReviewResult.mockImplementationOnce(() => {
      throw new Error("invalid format: missing required field");
    });

    const result = await runReviewerStage({
      reviewerRole, config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), trackBudget, iteration: 1,
      reviewRules: "rules", task: "do X", repeatDetector, budgetSummary, askQuestion: null
    });

    expect(result.review.approved).toBe(false);
    expect(result.review.blocking_issues[0].id).toBe("PARSE_ERROR");
  });

  it("blocks review when injection is detected in diff", async () => {
    const { scanDiff } = await import("../src/utils/injection-guard.js");
    scanDiff.mockReturnValueOnce({
      clean: false,
      findings: [{ type: "prompt_override", snippet: "ignore all rules", line: 10 }],
      summary: "1 injection found"
    });

    const result = await runReviewerStage({
      reviewerRole, config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), trackBudget, iteration: 1,
      reviewRules: "rules", task: "do X", repeatDetector, budgetSummary, askQuestion: null
    });

    expect(result.approved).toBe(false);
    expect(result.blocking_issues[0].id).toBe("INJECTION_PROMPT_OVERRIDE");
    expect(result.summary).toMatch(/injection guard/i);
  });

  it("throws when reviewer execution fails (non-rate-limit)", async () => {
    const { runReviewerWithFallback } = await import("../src/orchestrator/reviewer-fallback.js");
    runReviewerWithFallback.mockResolvedValueOnce({
      execResult: { ok: false },
      attempts: [{ reviewer: "codex", result: { ok: false, error: "reviewer crashed" } }]
    });

    await expect(
      runReviewerStage({
        reviewerRole, config: makeConfig(), logger, emitter, eventBase,
        session: makeSession(), trackBudget, iteration: 1,
        reviewRules: "rules", task: "do X", repeatDetector, budgetSummary, askQuestion: null
      })
    ).rejects.toThrow(/reviewer failed/i);
  });
});

describe("iteration-stages: runTddCheckStage", () => {
  let runTddCheckStage;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetSonarRunFn();
    ({ runTddCheckStage } = await import("../src/orchestrator/iteration-stages.js"));
  });

  it("returns ok when TDD policy passes", async () => {
    const result = await runTddCheckStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), trackBudget, iteration: 1, askQuestion: null
    });

    expect(result.action).toBe("ok");
  });

  it("returns continue when TDD policy fails (below fail_fast limit)", async () => {
    const { evaluateTddPolicy } = await import("../src/review/tdd-policy.js");
    evaluateTddPolicy.mockReturnValueOnce({
      ok: false,
      reason: "source_changed_without_tests",
      message: "Source files changed but no test files were modified",
      sourceFiles: ["src/foo.js"],
      testFiles: []
    });

    const result = await runTddCheckStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession({ repeated_issue_count: 0 }), trackBudget, iteration: 1, askQuestion: null
    });

    expect(result.action).toBe("continue");
  });

  it("skips TDD check for infra taskType", async () => {
    const { evaluateTddPolicy } = await import("../src/review/tdd-policy.js");
    evaluateTddPolicy.mockReturnValueOnce({
      ok: true,
      reason: "tdd_not_applicable_for_task_type",
      sourceFiles: [],
      testFiles: []
    });

    const result = await runTddCheckStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession({ resolved_policies: { taskType: "infra" } }), trackBudget, iteration: 1, askQuestion: null
    });

    expect(result.action).toBe("ok");
  });

  it("handles diff generation failure gracefully", async () => {
    const { generateDiff } = await import("../src/review/diff-generator.js");
    generateDiff.mockRejectedValueOnce(new Error("not a git repo"));

    const result = await runTddCheckStage({
      config: makeConfig(), logger, emitter, eventBase,
      session: makeSession(), trackBudget, iteration: 1, askQuestion: null
    });

    expect(result.action).toBe("continue");
    expect(result.stageResult.ok).toBe(false);
  });
});
