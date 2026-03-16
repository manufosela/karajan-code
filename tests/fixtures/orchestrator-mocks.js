import { vi } from "vitest";

// --- Review result constants ---

export const REVIEW_OK = JSON.stringify({
  approved: true,
  blocking_issues: [],
  non_blocking_suggestions: [],
  summary: "OK",
  confidence: 0.9,
});

export const REVIEW_REJECTED = JSON.stringify({
  approved: false,
  blocking_issues: [{ id: "B1", severity: "high", description: "Bug found" }],
  non_blocking_suggestions: [],
  summary: "Rejected",
  confidence: 0.9,
});

export const REVIEW_BLOCKING = JSON.stringify({
  approved: false,
  blocking_issues: [{ id: "B1", severity: "high", file: "a.js", line: 10, description: "Bug found", suggested_fix: "Fix it" }],
  non_blocking_suggestions: [],
  summary: "Blocking issues found",
  confidence: 0.85,
});

// --- Logger factories ---

export function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setContext: vi.fn(),
    resetContext: vi.fn(),
  };
}

export const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  setContext: vi.fn(),
};

// --- Config factory ---

export function makeConfig(overrides = {}) {
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
      refactorer: { provider: null },
    },
    pipeline: {
      planner: { enabled: false },
      refactorer: { enabled: false },
      solomon: { enabled: false },
    },
    coder_options: { auto_approve: true },
    reviewer_options: { retries: 0, fallback_reviewer: null },
    development: { methodology: "tdd", require_test_changes: true },
    sonarqube: {
      enabled: true,
      host: "http://localhost:9000",
      enforcement_profile: "pragmatic",
    },
    git: { auto_commit: false, auto_push: false, auto_pr: false },
    session: {
      max_iteration_minutes: 15,
      max_total_minutes: 120,
      fail_fast_repeats: 2,
      repeat_detection_threshold: 2,
      max_sonar_retries: 3,
      max_reviewer_retries: 3,
    },
    failFast: { repeatThreshold: 2 },
    output: { log_level: "error" },
    ...overrides,
  };
}

// --- Mock setup helpers ---

export function mockSessionStore() {
  let session = null;
  return {
    createSession: vi.fn(async (initial) => {
      session = {
        id: "s_test",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "running",
        checkpoints: [],
        ...initial,
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
    resumeSessionWithAnswer: vi.fn(async () => session),
  };
}

export function mockSessionStoreSimple() {
  return {
    createSession: vi.fn(async (initial) => ({
      id: "s_test",
      status: "running",
      checkpoints: [],
      ...initial,
    })),
    saveSession: vi.fn(async () => {}),
    loadSession: vi.fn(async () => null),
    addCheckpoint: vi.fn(async () => {}),
    markSessionStatus: vi.fn(async () => {}),
    pauseSession: vi.fn(async () => {}),
    resumeSessionWithAnswer: vi.fn(async () => null),
  };
}

export function mockDiffGenerator() {
  return {
    computeBaseRef: vi.fn().mockResolvedValue("abc123"),
    generateDiff: vi.fn().mockResolvedValue("diff content"),
  };
}

export function mockReviewSchema() {
  return {
    validateReviewResult: vi.fn((r) => r),
  };
}

export function mockTddPolicy() {
  return {
    evaluateTddPolicy: vi.fn().mockReturnValue({
      ok: true,
      reason: "pass",
      sourceFiles: ["a.js"],
      testFiles: ["a.test.js"],
      message: "OK",
    }),
  };
}

export function mockPromptsCoder() {
  return {
    buildCoderPrompt: vi.fn().mockReturnValue("coder prompt"),
  };
}

export function mockPromptsReviewer() {
  return {
    buildReviewerPrompt: vi.fn().mockReturnValue("reviewer prompt"),
  };
}

export function mockSonarApi() {
  return {
    getQualityGateStatus: vi.fn().mockResolvedValue({ status: "OK" }),
    getOpenIssues: vi.fn().mockResolvedValue({ total: 0, issues: [] }),
  };
}

export function mockSonarScanner() {
  return {
    runSonarScan: vi.fn().mockResolvedValue({ ok: true, projectKey: "test-key" }),
  };
}

export function mockSonarEnforcer() {
  return {
    shouldBlockByProfile: vi.fn().mockReturnValue(false),
    summarizeIssues: vi.fn().mockReturnValue(""),
  };
}

export function mockGitUtils() {
  return {
    ensureGitRepo: vi.fn().mockResolvedValue(true),
    currentBranch: vi.fn().mockResolvedValue("feat/test"),
    fetchBase: vi.fn(),
    syncBaseBranch: vi.fn(),
    ensureBranchUpToDateWithBase: vi.fn(),
    createBranch: vi.fn(),
    buildBranchName: vi.fn().mockReturnValue("feat/test"),
    commitAll: vi.fn().mockResolvedValue({ committed: true }),
    pushBranch: vi.fn(),
    createPullRequest: vi.fn(),
  };
}

export function mockFsPromises() {
  return {
    default: {
      readFile: vi.fn().mockResolvedValue("role instructions"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  };
}

export function mockCreateAgent(reviewOutput = REVIEW_OK) {
  return {
    createAgent: vi.fn(() => ({
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: reviewOutput }),
    })),
  };
}

// --- Convenience: apply all standard mocks after vi.resetAllMocks() ---

export async function reapplyDefaultMocks(reviewOutput = REVIEW_OK) {
  const { createAgent } = await import("../../src/agents/index.js");
  createAgent.mockReturnValue({
    runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
    reviewTask: vi.fn().mockResolvedValue({ ok: true, output: reviewOutput }),
  });

  const { evaluateTddPolicy } = await import("../../src/review/tdd-policy.js");
  evaluateTddPolicy.mockReturnValue({
    ok: true,
    reason: "pass",
    sourceFiles: ["a.js"],
    testFiles: ["a.test.js"],
    message: "OK",
  });

  const { computeBaseRef, generateDiff } = await import("../../src/review/diff-generator.js");
  computeBaseRef.mockResolvedValue("abc123");
  generateDiff.mockResolvedValue("diff content");

  const { validateReviewResult } = await import("../../src/review/schema.js");
  validateReviewResult.mockImplementation((r) => r);

  const { shouldBlockByProfile, summarizeIssues } = await import("../../src/sonar/enforcer.js");
  shouldBlockByProfile.mockReturnValue(false);
  summarizeIssues.mockReturnValue("");

  const { buildCoderPrompt } = await import("../../src/prompts/coder.js");
  buildCoderPrompt.mockReturnValue("coder prompt");

  const { buildReviewerPrompt } = await import("../../src/prompts/reviewer.js");
  buildReviewerPrompt.mockReturnValue("reviewer prompt");

  const { detectTestFramework } = await import("../../src/utils/project-detect.js");
  detectTestFramework.mockResolvedValue({ hasTests: true, framework: "vitest" });

  const fs = await import("node:fs/promises");
  fs.default.readFile.mockResolvedValue("role instructions");
}
