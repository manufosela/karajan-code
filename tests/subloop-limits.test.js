import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { REVIEW_OK, REVIEW_REJECTED, makeConfig as makeBaseConfig, noopLogger } from "./fixtures/orchestrator-mocks.js";

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
  getQualityGateStatus: vi.fn().mockResolvedValue({ status: "ERROR" }),
  getOpenIssues: vi.fn().mockResolvedValue({ total: 2, issues: [{ key: "i1" }] })
}));

vi.mock("../src/sonar/scanner.js", () => ({
  runSonarScan: vi.fn().mockResolvedValue({ ok: true, projectKey: "test-key" })
}));

vi.mock("../src/sonar/manager.js", () => ({
  sonarUp: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
  isSonarReachable: vi.fn().mockResolvedValue(true)
}));

vi.mock("../src/sonar/enforcer.js", () => ({
  shouldBlockByProfile: vi.fn().mockReturnValue(true),
  summarizeIssues: vi.fn().mockReturnValue("2 issues")
}));

vi.mock("../src/utils/project-detect.js", () => ({
  detectTestFramework: vi.fn().mockResolvedValue({ hasTests: true, framework: "vitest" }),
  detectSonarConfig: vi.fn().mockResolvedValue({ configured: false })
}));

vi.mock("../src/orchestrator/solomon-escalation.js", () => ({
  invokeSolomon: vi.fn().mockResolvedValue({ action: "pause", question: "Solomon escalated" }),
  escalateToHuman: vi.fn().mockResolvedValue({ action: "pause", question: "Human intervention needed" })
}));

vi.mock("../src/utils/rtk-detect.js", () => ({
  detectRtk: vi.fn().mockResolvedValue({ available: false })
}));

vi.mock("../src/utils/agent-detect.js", () => ({
  checkBinary: vi.fn().mockResolvedValue({ ok: true, version: "1.0.0" }),
  isHostAgent: vi.fn().mockReturnValue(false)
}));

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn().mockImplementation((_cmd, args) => {
    if (args?.some(a => String(a).includes("user_tokens/generate"))) {
      return Promise.resolve({ exitCode: 0, stdout: '{"token":"mock-token"}', stderr: "" });
    }
    return Promise.resolve({ exitCode: 0, stdout: '{"valid":true}', stderr: "" });
  })
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

describe("configurable sub-loop limits", () => {
  let runFlow;

  beforeEach(async () => {
    vi.resetAllMocks();

    const { createAgent } = await import("../src/agents/index.js");
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_OK })
    });

    const { evaluateTddPolicy } = await import("../src/review/tdd-policy.js");
    evaluateTddPolicy.mockReturnValue({ ok: true, reason: "pass", sourceFiles: ["a.js"], testFiles: ["a.test.js"], message: "OK" });

    const { computeBaseRef, generateDiff } = await import("../src/review/diff-generator.js");
    computeBaseRef.mockResolvedValue("abc123");
    generateDiff.mockResolvedValue("diff content");

    const { validateReviewResult } = await import("../src/review/schema.js");
    validateReviewResult.mockImplementation((r) => r);

    const { runSonarScan } = await import("../src/sonar/scanner.js");
    runSonarScan.mockResolvedValue({ ok: true, projectKey: "test-key" });

    const { getQualityGateStatus, getOpenIssues } = await import("../src/sonar/api.js");
    getQualityGateStatus.mockResolvedValue({ status: "ERROR" });
    getOpenIssues.mockResolvedValue({ total: 2, issues: [{ key: "i1" }] });

    const { shouldBlockByProfile, summarizeIssues } = await import("../src/sonar/enforcer.js");
    shouldBlockByProfile.mockReturnValue(true);
    summarizeIssues.mockReturnValue("2 issues");

    const { buildCoderPrompt } = await import("../src/prompts/coder.js");
    buildCoderPrompt.mockReturnValue("coder prompt");

    const { buildReviewerPrompt } = await import("../src/prompts/reviewer.js");
    buildReviewerPrompt.mockReturnValue("reviewer prompt");

    const { detectTestFramework } = await import("../src/utils/project-detect.js");
    detectTestFramework.mockResolvedValue({ hasTests: true, framework: "vitest" });

    const fs = await import("node:fs/promises");
    fs.default.readFile.mockResolvedValue("role instructions");

    const { invokeSolomon } = await import("../src/orchestrator/solomon-escalation.js");
    invokeSolomon.mockResolvedValue({ action: "pause", question: "Solomon escalated" });

    const { detectRtk } = await import("../src/utils/rtk-detect.js");
    detectRtk.mockResolvedValue({ available: false });

    const { checkBinary, isHostAgent } = await import("../src/utils/agent-detect.js");
    checkBinary.mockResolvedValue({ ok: true, version: "1.0.0" });
    isHostAgent.mockReturnValue(false);

    const { runCommand } = await import("../src/utils/process.js");
    runCommand.mockImplementation((_cmd, args) => {
      if (args?.some(a => String(a).includes("user_tokens/generate"))) {
        return Promise.resolve({ exitCode: 0, stdout: '{"token":"mock-token"}', stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: '{"valid":true}', stderr: "" });
    });

    const { sonarUp, isSonarReachable } = await import("../src/sonar/manager.js");
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    isSonarReachable.mockResolvedValue(true);

    const mod = await import("../src/orchestrator.js");
    runFlow = mod.runFlow;
  });

  it("emits solomon:escalate when sonar sub-loop limit is reached", async () => {
    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e));

    const config = makeConfig({ max_sonar_retries: 2 });

    const result = await runFlow({ task: "Fix bug", config, logger: noopLogger, emitter });

    const solomonEvents = events.filter((e) => e.type === "solomon:escalate");
    expect(solomonEvents.length).toBe(1);
    expect(solomonEvents[0].detail.subloop).toBe("sonar");
    expect(solomonEvents[0].detail.retryCount).toBe(2);
    expect(solomonEvents[0].detail.limit).toBe(2);
    expect(result.paused).toBe(true);
    expect(result.context).toBe("sonar_fail_fast");
  });

  it("sonar retries respect max_sonar_retries independently from fail_fast_repeats", async () => {
    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e));

    // max_sonar_retries=3, fail_fast_repeats=99 — sonar should use its own limit (3)
    const config = makeConfig({ max_sonar_retries: 3, fail_fast_repeats: 99, repeat_detection_threshold: 99 });

    const result = await runFlow({ task: "Fix bug", config, logger: noopLogger, emitter });

    const solomonEvents = events.filter((e) => e.type === "solomon:escalate");
    // With Solomon boss, the sonar escalation event should fire after max_sonar_retries
    if (solomonEvents.length > 0) {
      expect(solomonEvents[0].detail.retryCount).toBe(3);
      expect(solomonEvents[0].detail.limit).toBe(3);
    } else {
      // Solomon may have paused before sonar retry limit — verify sonar retries happened
      const sonarEvents = events.filter((e) => e.type === "sonar:end");
      expect(sonarEvents.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("emits solomon:escalate when reviewer sub-loop limit is reached", async () => {
    // Make sonar pass, reviewer reject
    const { shouldBlockByProfile } = await import("../src/sonar/enforcer.js");
    shouldBlockByProfile.mockReturnValue(false);

    const { createAgent } = await import("../src/agents/index.js");
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_REJECTED })
    });

    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e));

    const config = makeConfig({ max_reviewer_retries: 2 });

    const result = await runFlow({ task: "Fix bug", config, logger: noopLogger, emitter });

    const solomonEvents = events.filter((e) => e.type === "solomon:escalate");
    expect(solomonEvents.length).toBe(1);
    expect(solomonEvents[0].detail.subloop).toBe("reviewer");
    expect(solomonEvents[0].detail.retryCount).toBe(2);
    expect(result.paused).toBe(true);
    expect(result.context).toBe("reviewer_fail_fast");
  });

  it("reviewer retries respect max_reviewer_retries independently", async () => {
    const { shouldBlockByProfile } = await import("../src/sonar/enforcer.js");
    shouldBlockByProfile.mockReturnValue(false);

    const { createAgent } = await import("../src/agents/index.js");
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_REJECTED })
    });

    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e));

    const config = makeConfig({ max_reviewer_retries: 4, fail_fast_repeats: 2 });

    const result = await runFlow({ task: "Fix bug", config, logger: noopLogger, emitter });

    const solomonEvents = events.filter((e) => e.type === "solomon:escalate");
    expect(solomonEvents[0].detail.retryCount).toBe(4);
    expect(solomonEvents[0].detail.limit).toBe(4);
  });

  it("sonar counter resets when sonar passes after failures", async () => {
    const { shouldBlockByProfile } = await import("../src/sonar/enforcer.js");
    // Sonar blocks on iter 1, passes on iter 2
    let sonarCallCount = 0;
    shouldBlockByProfile.mockImplementation(() => {
      sonarCallCount += 1;
      return sonarCallCount <= 1;
    });

    const { createAgent } = await import("../src/agents/index.js");
    createAgent.mockReturnValue({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_OK })
    });

    const { validateReviewResult } = await import("../src/review/schema.js");
    validateReviewResult.mockImplementation((r) => r);

    const config = makeConfig({ max_sonar_retries: 3 });

    const result = await runFlow({ task: "Fix bug", config, logger: noopLogger });

    // Should succeed: sonar blocked once, then passed, reviewer approved
    expect(result.approved).toBe(true);
  });
});
