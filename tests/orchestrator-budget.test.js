import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const REVIEW_APPROVED = JSON.stringify({
  approved: true,
  blocking_issues: [],
  non_blocking_suggestions: [],
  summary: "OK",
  confidence: 0.95
});

const REVIEW_REJECTED = JSON.stringify({
  approved: false,
  blocking_issues: [{ id: "B1", severity: "high", description: "Fix issue" }],
  non_blocking_suggestions: [],
  summary: "Needs fixes",
  confidence: 0.9
});

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../src/session-store.js", () => {
  let session = null;
  return {
    createSession: vi.fn(async (initial) => {
      session = {
        id: "s_budget",
        status: "running",
        checkpoints: [],
        ...initial
      };
      return session;
    }),
    saveSession: vi.fn(async () => {}),
    loadSession: vi.fn(async () => session),
    addCheckpoint: vi.fn(async (s, cp) => {
      s.checkpoints.push(cp);
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
  getUntrackedFiles: vi.fn().mockResolvedValue([]),
  generateDiff: vi.fn().mockResolvedValue("diff"),
  setRunner: vi.fn()
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

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockResolvedValue("rules"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
  }
}));

describe("orchestrator budget integration", () => {
  let runFlow;
  let createAgent;

  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    setContext: vi.fn(), resetContext: vi.fn()
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ runFlow } = await import("../src/orchestrator.js"));
    ({ createAgent } = await import("../src/agents/index.js"));
  });

  it("adds budget summary to session:end when agent usage is reported", async () => {
    createAgent.mockImplementation((name) => {
      if (name === "codex") {
        return {
          runTask: vi.fn().mockResolvedValue({
            ok: true,
            output: "",
            usage: { tokens_in: 100, tokens_out: 150, cost_usd: 0.35 }
          })
        };
      }
      return {
        runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
        reviewTask: vi.fn().mockResolvedValue({
          ok: true,
          output: REVIEW_APPROVED,
          tokens_in: 20,
          tokens_out: 30,
          cost_usd: 0.05
        })
      };
    });

    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (event) => events.push(event));

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 1,
      max_budget_usd: 5,
      review_rules: "./.karajan/review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: false },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const result = await runFlow({ task: "budget task", config, logger, emitter });
    expect(result.approved).toBe(true);

    const endEvent = events.find((e) => e.type === "session:end");
    // Budget includes coder + reviewer + final audit stage (audit uses coder's provider)
    expect(endEvent.detail.budget.total_tokens).toBeGreaterThanOrEqual(300);
    expect(endEvent.detail.budget.total_cost_usd).toBeGreaterThanOrEqual(0.4);
    expect(endEvent.detail.budget.breakdown_by_role.coder.total_cost_usd).toBe(0.35);
    expect(endEvent.detail.budget.breakdown_by_role.reviewer.total_tokens).toBe(50);
  });

  it("aborts when budget is exceeded before a new iteration starts", async () => {
    createAgent.mockImplementation((name) => {
      if (name === "codex") {
        return {
          runTask: vi.fn().mockResolvedValue({ ok: true, output: "" })
        };
      }
      return {
        runTask: vi.fn().mockResolvedValue({ ok: true, output: "plan", cost_usd: 0.2 }),
        reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_REJECTED })
      };
    });

    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (event) => events.push(event));

    const config = {
      coder: "codex",
      reviewer: "claude",
      roles: { planner: { provider: "claude" } },
      pipeline: { planner: { enabled: true } },
      review_mode: "standard",
      max_iterations: 2,
      max_budget_usd: 0.1,
      review_rules: "./.karajan/review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: false },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    await expect(runFlow({ task: "budget limit", config, logger, emitter })).rejects.toThrow("Budget exceeded");

    const endEvent = events.filter((e) => e.type === "session:end").at(-1);
    expect(endEvent.detail.reason).toBe("budget_exceeded");
    expect(endEvent.detail.budget.total_cost_usd).toBe(0.2);
  });

  it("auto-calculates cost when only tokens and model are reported", async () => {
    const { evaluateTddPolicy } = await import("../src/review/tdd-policy.js");
    evaluateTddPolicy.mockReturnValue({
      ok: true,
      reason: "pass",
      sourceFiles: ["a.js"],
      testFiles: ["a.test.js"],
      message: "OK"
    });

    createAgent.mockImplementation((name) => {
      if (name === "codex") {
        return {
          runTask: vi.fn().mockResolvedValue({
            ok: true,
            output: "",
            usage: { tokens_in: 1000000, tokens_out: 1000000, model: "o4-mini" }
          })
        };
      }
      return {
        runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
        reviewTask: vi.fn().mockResolvedValue({
          ok: true,
          output: REVIEW_APPROVED
        })
      };
    });

    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (event) => events.push(event));

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 1,
      max_budget_usd: 5,
      review_rules: "./.karajan/review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: { enabled: false },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const result = await runFlow({ task: "budget model pricing", config, logger, emitter });
    expect(result.approved).toBe(true);

    const endEvent = events.find((e) => e.type === "session:end");
    // Budget includes coder + reviewer + final audit stage (audit uses coder's provider)
    expect(endEvent.detail.budget.total_cost_usd).toBeGreaterThanOrEqual(5.5);
  });
});
