import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/agents/availability.js", () => ({
  assertAgentsAvailable: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  resolveRole: vi.fn((config, role) => ({
    provider: config.roles?.[role]?.provider || role
  }))
}));

vi.mock("../src/review/diff-generator.js", () => ({
  computeBaseRef: vi.fn().mockResolvedValue("abc123"),
  getUntrackedFiles: vi.fn().mockResolvedValue([]),
  generateDiff: vi.fn().mockResolvedValue("diff --git a/file.js b/file.js\n+added line"),
  setProjectDir: vi.fn()
}));

vi.mock("../src/prompts/reviewer.js", () => ({
  buildReviewerPrompt: vi.fn().mockReturnValue("reviewer prompt")
}));

vi.mock("../src/review/profiles.js", () => ({
  resolveReviewProfile: vi.fn().mockResolvedValue({ mode: "standard", rules: "review rules content" })
}));

function makeConfig(overrides = {}) {
  return {
    roles: { reviewer: { provider: "claude" } },
    reviewer_options: { fallback_reviewer: "codex" },
    base_branch: "main",
    review_rules: ".karajan/review-rules.md",
    review_mode: "standard",
    ...overrides
  };
}

const noopLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setContext: vi.fn()
};

describe("commands/review", () => {
  let createAgent, assertAgentsAvailable, computeBaseRef, generateDiff, buildReviewerPrompt;

  beforeEach(async () => {
    vi.resetAllMocks();

    const agents = await import("../src/agents/index.js");
    createAgent = agents.createAgent;

    const avail = await import("../src/agents/availability.js");
    assertAgentsAvailable = avail.assertAgentsAvailable;

    const diff = await import("../src/review/diff-generator.js");
    computeBaseRef = diff.computeBaseRef;
    generateDiff = diff.generateDiff;
    computeBaseRef.mockResolvedValue("abc123");
    generateDiff.mockResolvedValue("diff content");

    const prompts = await import("../src/prompts/reviewer.js");
    buildReviewerPrompt = prompts.buildReviewerPrompt;
    buildReviewerPrompt.mockReturnValue("reviewer prompt");

    const profiles = await import("../src/review/profiles.js");
    profiles.resolveReviewProfile.mockResolvedValue({ mode: "standard", rules: "review rules content" });

    createAgent.mockReturnValue({
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: '{"approved": true}', exitCode: 0 })
    });
  });

  it("asserts only reviewer provider is available upfront", async () => {
    const { reviewCommand } = await import("../src/commands/review.js");
    const config = makeConfig({ reviewer_options: { fallback_reviewer: "codex" } });
    await reviewCommand({ task: "review task", config, logger: noopLogger });

    // Should only require primary reviewer "claude", even if fallback is "codex"
    expect(assertAgentsAvailable).toHaveBeenCalledWith(["claude"]);
  });

  it("does not require fallback if set to null", async () => {
    const { reviewCommand } = await import("../src/commands/review.js");
    const config = makeConfig({ reviewer_options: { fallback_reviewer: null } });
    await reviewCommand({ task: "review task", config, logger: noopLogger });

    expect(assertAgentsAvailable).toHaveBeenCalledWith(["claude"]);
  });

  it("creates agent with reviewer provider", async () => {
    const { reviewCommand } = await import("../src/commands/review.js");
    const config = makeConfig();
    await reviewCommand({ task: "review task", config, logger: noopLogger });

    expect(createAgent).toHaveBeenCalledWith("claude", config, noopLogger);
  });

  it("computes base ref from config and override", async () => {
    const { reviewCommand } = await import("../src/commands/review.js");
    await reviewCommand({ task: "review task", config: makeConfig(), logger: noopLogger, baseRef: "custom-ref" });

    expect(computeBaseRef).toHaveBeenCalledWith({ baseBranch: "main", baseRef: "custom-ref" });
  });

  it("generates diff and builds reviewer prompt", async () => {
    const { reviewCommand } = await import("../src/commands/review.js");
    await reviewCommand({ task: "review task", config: makeConfig(), logger: noopLogger });

    expect(generateDiff).toHaveBeenCalledWith({ baseRef: "abc123" });
    expect(buildReviewerPrompt).toHaveBeenCalledWith(expect.objectContaining({
      task: "review task",
      diff: "diff content",
      reviewRules: "review rules content",
      mode: "standard"
    }));
  });

  it("calls reviewTask with prompt and role", async () => {
    const { reviewCommand } = await import("../src/commands/review.js");
    await reviewCommand({ task: "review task", config: makeConfig(), logger: noopLogger });

    const agent = createAgent.mock.results[0].value;
    expect(agent.reviewTask).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "reviewer prompt",
      role: "reviewer"
    }));
  });

  it("throws when reviewer fails", async () => {
    createAgent.mockReturnValue({
      reviewTask: vi.fn().mockResolvedValue({ ok: false, error: "review crashed", exitCode: 1 })
    });

    const { reviewCommand } = await import("../src/commands/review.js");
    await expect(
      reviewCommand({ task: "bad review", config: makeConfig(), logger: noopLogger })
    ).rejects.toThrow("review crashed");
  });

  it("uses fallback rules when no profile files found", async () => {
    const profiles = await import("../src/review/profiles.js");
    profiles.resolveReviewProfile.mockResolvedValue({
      mode: "standard",
      rules: "Focus on critical issues: security vulnerabilities, logic errors, and broken tests."
    });

    const { reviewCommand } = await import("../src/commands/review.js");
    await reviewCommand({ task: "review task", config: makeConfig(), logger: noopLogger });

    expect(buildReviewerPrompt).toHaveBeenCalledWith(expect.objectContaining({
      reviewRules: "Focus on critical issues: security vulnerabilities, logic errors, and broken tests."
    }));
  });

  it("logs completion on success", async () => {
    const { reviewCommand } = await import("../src/commands/review.js");
    await reviewCommand({ task: "review task", config: makeConfig(), logger: noopLogger });

    expect(noopLogger.info).toHaveBeenCalledWith(expect.stringContaining("completed"));
  });
});
