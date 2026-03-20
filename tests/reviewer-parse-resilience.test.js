import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { REVIEW_OK, makeConfig as makeBaseConfig, noopLogger, reapplyDefaultMocks } from "./fixtures/orchestrator-mocks.js";

function makeConfig(sessionOverrides = {}) {
  return makeBaseConfig({
    max_iterations: 10,
    session: {
      max_iteration_minutes: 15,
      max_total_minutes: 120,
      fail_fast_repeats: 2,
      repeat_detection_threshold: 99,
      max_sonar_retries: 3,
      max_reviewer_retries: 3,
      ...sessionOverrides
    },
    failFast: { repeatThreshold: 99 }
  });
}

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/session-store.js", () => {
  let session = null;
  return {
    createSession: vi.fn(async (initial) => {
      session = { id: "s_test", status: "running", checkpoints: [], ...initial };
      return session;
    }),
    saveSession: vi.fn(async () => {}),
    loadSession: vi.fn(async () => session),
    addCheckpoint: vi.fn(async (s, cp) => { s.checkpoints.push(cp); }),
    markSessionStatus: vi.fn(async (s, status) => { s.status = status; }),
    pauseSession: vi.fn(async (s, data) => { s.status = "paused"; s.paused_state = data; }),
    resumeSessionWithAnswer: vi.fn(async () => session)
  };
});

vi.mock("../src/review/diff-generator.js", () => ({
  computeBaseRef: vi.fn().mockResolvedValue("abc123"),
  getUntrackedFiles: vi.fn().mockResolvedValue([]),
  generateDiff: vi.fn().mockResolvedValue("diff content")
}));

vi.mock("../src/review/schema.js", () => ({
  validateReviewResult: vi.fn((r) => r)
}));

vi.mock("../src/review/tdd-policy.js", () => ({
  evaluateTddPolicy: vi.fn().mockReturnValue({ ok: true, reason: "pass", sourceFiles: ["a.js"], testFiles: ["a.test.js"], message: "OK" })
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

vi.mock("../src/orchestrator/solomon-escalation.js", () => ({
  invokeSolomon: vi.fn().mockResolvedValue({ action: "pause", question: "Solomon escalated" }),
  escalateToHuman: vi.fn().mockResolvedValue({ action: "pause", question: "Human needed" })
}));

vi.mock("../src/sonar/manager.js", () => ({
  sonarUp: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
  isSonarReachable: vi.fn().mockResolvedValue(true)
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockResolvedValue("role instructions"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
  }
}));

describe("reviewer parse resilience", () => {
  let runFlow;

  beforeEach(async () => {
    vi.resetAllMocks();
    await reapplyDefaultMocks();

    const { invokeSolomon } = await import("../src/orchestrator/solomon-escalation.js");
    invokeSolomon.mockResolvedValue({ action: "pause", question: "Solomon escalated" });

    const { sonarUp, isSonarReachable } = await import("../src/sonar/manager.js");
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    isSonarReachable.mockResolvedValue(true);

    const { runSonarScan } = await import("../src/sonar/scanner.js");
    runSonarScan.mockResolvedValue({ ok: true, projectKey: "test-key" });

    const { getQualityGateStatus, getOpenIssues } = await import("../src/sonar/api.js");
    getQualityGateStatus.mockResolvedValue({ status: "OK" });
    getOpenIssues.mockResolvedValue({ total: 0, issues: [] });

    const mod = await import("../src/orchestrator.js");
    runFlow = mod.runFlow;
  });

  it("does not crash when reviewer returns non-JSON — treats as rejected iteration", async () => {
    let reviewerCallCount = 0;
    const { createAgent } = await import("../src/agents/index.js");
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
      reviewTask: vi.fn().mockImplementation(() => {
        reviewerCallCount += 1;
        if (reviewerCallCount === 1) {
          // First attempt: garbage output
          return { ok: true, output: "This is not JSON at all!" };
        }
        // Second attempt: valid JSON
        return { ok: true, output: REVIEW_OK };
      })
    });

    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e));

    const config = makeConfig({ max_iterations: 3 });
    const result = await runFlow({ task: "Fix bug", config, logger: noopLogger, emitter });

    // Should not crash — should eventually approve on second iteration
    expect(result.approved).toBe(true);
    expect(reviewerCallCount).toBe(2);

    // First reviewer:end should show parse failure
    const reviewerEndEvents = events.filter((e) => e.type === "reviewer:end");
    expect(reviewerEndEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("includes PARSE_ERROR blocking issue when reviewer output is garbage", async () => {
    const { createAgent } = await import("../src/agents/index.js");
    let reviewerCallCount = 0;
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
      reviewTask: vi.fn().mockImplementation(() => {
        reviewerCallCount += 1;
        if (reviewerCallCount === 1) {
          return { ok: true, output: "garbage output" };
        }
        return { ok: true, output: REVIEW_OK };
      })
    });

    const { validateReviewResult } = await import("../src/review/schema.js");
    validateReviewResult.mockImplementation((r) => {
      // Real validation for the second call
      if (r.approved !== undefined) return r;
      throw new Error("bad shape");
    });

    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e));

    const config = makeConfig({ max_iterations: 3 });
    await runFlow({ task: "Fix bug", config, logger: noopLogger, emitter });

    // The first reviewer:end should contain the parse error info
    const firstReviewerEnd = events.find(
      (e) => e.type === "reviewer:end" && e.detail?.issues?.some((i) => i.includes("PARSE_ERROR"))
    );
    expect(firstReviewerEnd).toBeTruthy();
  });

  it("does not crash when validateReviewResult throws", async () => {
    const { createAgent } = await import("../src/agents/index.js");
    let reviewerCallCount = 0;
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
      reviewTask: vi.fn().mockImplementation(() => {
        reviewerCallCount += 1;
        if (reviewerCallCount === 1) {
          // Valid JSON but missing required field
          return { ok: true, output: JSON.stringify({ approved: "not-boolean", blocking_issues: [] }) };
        }
        return { ok: true, output: REVIEW_OK };
      })
    });

    const { validateReviewResult } = await import("../src/review/schema.js");
    validateReviewResult.mockImplementation((r) => {
      if (typeof r.approved !== "boolean") {
        throw new Error("Reviewer output missing boolean field: approved");
      }
      return r;
    });

    const emitter = new EventEmitter();
    const config = makeConfig({ max_iterations: 3 });
    const result = await runFlow({ task: "Fix bug", config, logger: noopLogger, emitter });

    // Should recover on second iteration
    expect(result.approved).toBe(true);
    expect(reviewerCallCount).toBe(2);
  });
});
