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

// --- Logger factories ---

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
