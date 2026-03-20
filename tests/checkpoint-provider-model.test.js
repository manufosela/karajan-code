import { beforeEach, describe, expect, it, vi } from "vitest";

const triageRunMock = vi.fn();
const researcherRunMock = vi.fn();
const coderExecuteMock = vi.fn();
const refactorerExecuteMock = vi.fn();
const sonarRunMock = vi.fn();
const testerRunMock = vi.fn();
const securityRunMock = vi.fn();

vi.mock("../src/roles/triage-role.js", () => ({
  TriageRole: class {
    async init() {}
    async run() { return triageRunMock(); }
  }
}));

vi.mock("../src/roles/researcher-role.js", () => ({
  ResearcherRole: class {
    async init() {}
    async run() { return researcherRunMock(); }
  }
}));

vi.mock("../src/roles/planner-role.js", () => {
  const executeMock = vi.fn();
  return {
    PlannerRole: class {
      context = {};
      async init() {}
      async execute(task) { return executeMock(task); }
    },
    __executeMock: executeMock
  };
});

vi.mock("../src/roles/coder-role.js", () => ({
  CoderRole: class {
    async init() {}
    async execute(input) { return coderExecuteMock(input); }
  }
}));

vi.mock("../src/roles/refactorer-role.js", () => ({
  RefactorerRole: class {
    async init() {}
    async execute(task) { return refactorerExecuteMock(task); }
  }
}));

vi.mock("../src/roles/sonar-role.js", () => ({
  SonarRole: class {
    async init() {}
    async run() { return sonarRunMock(); }
  }
}));

vi.mock("../src/roles/tester-role.js", () => ({
  TesterRole: class {
    async init() {}
    async run() { return testerRunMock(); }
  }
}));

vi.mock("../src/roles/security-role.js", () => ({
  SecurityRole: class {
    async init() {}
    async run() { return securityRunMock(); }
  }
}));

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

const addCheckpointMock = vi.fn(async () => {});

vi.mock("../src/session-store.js", () => ({
  addCheckpoint: addCheckpointMock,
  markSessionStatus: vi.fn(async () => {}),
  saveSession: vi.fn(async () => {}),
  pauseSession: vi.fn(async () => {})
}));

vi.mock("../src/utils/events.js", () => ({
  emitProgress: vi.fn(),
  makeEvent: vi.fn((type, base, payload) => ({ type, ...base, ...payload }))
}));

vi.mock("../src/prompts/planner.js", () => ({
  parsePlannerOutput: vi.fn(() => ({ title: "Plan", approach: "Approach", steps: ["Step 1"] }))
}));

vi.mock("../src/review/diff-generator.js", () => ({
  getUntrackedFiles: vi.fn().mockResolvedValue([]),
  generateDiff: vi.fn().mockResolvedValue("diff content")
}));

vi.mock("../src/review/tdd-policy.js", () => ({
  evaluateTddPolicy: vi.fn().mockReturnValue({
    ok: true, reason: "pass", sourceFiles: ["a.js"], testFiles: ["a.test.js"], message: "OK"
  })
}));

vi.mock("../src/review/schema.js", () => ({
  validateReviewResult: vi.fn((r) => r)
}));

vi.mock("../src/orchestrator/reviewer-fallback.js", () => ({
  runReviewerWithFallback: vi.fn()
}));

vi.mock("../src/orchestrator/agent-fallback.js", () => ({
  runCoderWithFallback: vi.fn()
}));

vi.mock("../src/orchestrator/solomon-escalation.js", () => ({
  invokeSolomon: vi.fn().mockResolvedValue({ action: "pause", question: "Solomon escalated" }),
  escalateToHuman: vi.fn().mockResolvedValue({ action: "pause", question: "Human needed" })
}));

vi.mock("../src/sonar/manager.js", () => ({
  sonarUp: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
  isSonarReachable: vi.fn().mockResolvedValue(true)
}));

vi.mock("../src/utils/rate-limit-detector.js", () => ({
  detectRateLimit: vi.fn(() => ({ isRateLimit: false }))
}));

vi.mock("../src/utils/model-selector.js", () => ({
  selectModelsForRoles: vi.fn(() => ({ modelOverrides: {}, reasoning: {} }))
}));

describe("checkpoints include provider and model", () => {
  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    setContext: vi.fn(), resetContext: vi.fn()
  };
  const emitter = { emit: vi.fn() };
  const eventBase = { sessionId: "s1", iteration: 0, stage: null, startedAt: Date.now() };
  const trackBudget = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("pre-loop stages", () => {
    it("triage checkpoint includes provider and model", async () => {
      triageRunMock.mockResolvedValue({
        ok: true,
        result: { level: "medium", roles: ["reviewer"], reasoning: "Medium" },
        usage: { tokens_in: 100, tokens_out: 80 }
      });
      const config = {
        roles: { triage: { provider: "claude", model: "claude/haiku" } },
        model_selection: { enabled: false }
      };
      const session = { id: "s1", task: "Fix bug", checkpoints: [] };
      const coderRole = { provider: "codex", model: "codex/o4-mini" };

      const { runTriageStage } = await import("../src/orchestrator/pre-loop-stages.js");
      await runTriageStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(addCheckpointMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stage: "triage",
          provider: "claude",
          model: "claude/haiku"
        })
      );
    });

    it("triage checkpoint uses coderRole as fallback when no triage role config", async () => {
      triageRunMock.mockResolvedValue({
        ok: true,
        result: { level: "simple", roles: [], reasoning: "Simple" },
        usage: {}
      });
      const config = { roles: {}, model_selection: { enabled: false } };
      const session = { id: "s1", task: "Fix typo", checkpoints: [] };
      const coderRole = { provider: "codex", model: "codex/o4-mini" };

      const { runTriageStage } = await import("../src/orchestrator/pre-loop-stages.js");
      await runTriageStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(addCheckpointMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stage: "triage",
          provider: "codex",
          model: "codex/o4-mini"
        })
      );
    });

    it("researcher checkpoint includes provider and model", async () => {
      researcherRunMock.mockResolvedValue({ ok: true, summary: "Found files", result: {} });
      const config = { roles: { researcher: { provider: "gemini", model: "gemini/pro" } } };
      const session = { id: "s1", task: "Investigate", checkpoints: [] };
      const coderRole = { provider: "claude", model: "claude/sonnet" };

      const { runResearcherStage } = await import("../src/orchestrator/pre-loop-stages.js");
      await runResearcherStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget });

      expect(addCheckpointMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stage: "researcher",
          provider: "gemini",
          model: "gemini/pro"
        })
      );
    });

    it("planner checkpoint includes provider and model", async () => {
      const { __executeMock } = await import("../src/roles/planner-role.js");
      __executeMock.mockResolvedValue({ ok: true, result: { plan: "Step 1: do stuff" } });
      const plannerRole = { provider: "claude", model: "claude/opus" };
      const session = { id: "s1", task: "Plan migration", checkpoints: [] };
      const config = { roles: {} };

      const { runPlannerStage } = await import("../src/orchestrator/pre-loop-stages.js");
      await runPlannerStage({ config, logger, emitter, eventBase, session, plannerRole, researchContext: null, trackBudget });

      expect(addCheckpointMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stage: "planner",
          provider: "claude",
          model: "claude/opus"
        })
      );
    });
  });

  describe("iteration stages", () => {
    const makeSession = () => ({
      id: "s1",
      task: "Fix bug",
      checkpoints: [],
      last_reviewer_feedback: null,
      last_sonar_summary: null,
      repeated_issue_count: 0,
      session_start_sha: "abc123",
      sonar_retry_count: 0
    });

    it("coder checkpoint includes provider and model", async () => {
      coderExecuteMock.mockResolvedValue({ ok: true, result: {} });
      const coderRole = { provider: "claude", model: "claude/sonnet" };
      const coderRoleInstance = {
        execute: coderExecuteMock,
        provider: "claude",
        model: "claude/sonnet"
      };
      const session = makeSession();
      const config = { coder_options: {} };

      const { runCoderStage } = await import("../src/orchestrator/iteration-stages.js");
      await runCoderStage({
        coderRoleInstance, coderRole, config, logger, emitter, eventBase,
        session, plannedTask: "Fix bug", trackBudget, iteration: 1
      });

      expect(addCheckpointMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stage: "coder",
          provider: "claude",
          model: "claude/sonnet"
        })
      );
    });

    it("reviewer checkpoint includes provider and model", async () => {
      const { runReviewerWithFallback } = await import("../src/orchestrator/reviewer-fallback.js");
      runReviewerWithFallback.mockResolvedValue({
        execResult: {
          ok: true,
          result: {
            approved: true,
            blocking_issues: [],
            non_blocking_suggestions: [],
            raw_summary: "LGTM",
            confidence: 90
          }
        },
        attempts: []
      });

      const reviewerRole = { provider: "codex", model: "codex/o4-mini" };
      const session = makeSession();
      const config = { reviewer_options: {} };
      const repeatDetector = {
        addIteration: vi.fn(),
        isStalled: vi.fn(() => ({ stalled: false })),
        getRepeatCounts: vi.fn(() => ({ reviewer: 0 }))
      };

      const { runReviewerStage } = await import("../src/orchestrator/iteration-stages.js");
      await runReviewerStage({
        reviewerRole, config, logger, emitter, eventBase,
        session, trackBudget, iteration: 1, reviewRules: "",
        task: "Fix bug", repeatDetector, budgetSummary: vi.fn()
      });

      expect(addCheckpointMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stage: "reviewer",
          provider: "codex",
          model: "codex/o4-mini"
        })
      );
    });

    it("sonar checkpoint includes provider sonar and model null", async () => {
      sonarRunMock.mockResolvedValue({
        ok: true,
        summary: "Sonar passed",
        result: { gateStatus: "OK", blocking: false, openIssuesTotal: 0, projectKey: "prj" }
      });
      const session = makeSession();
      const config = { session: {} };
      const sonarState = { issuesInitial: null, issuesFinal: null };

      const { runSonarStage } = await import("../src/orchestrator/iteration-stages.js");
      await runSonarStage({
        config, logger, emitter, eventBase, session, trackBudget,
        iteration: 1, repeatDetector: { addIteration: vi.fn(), isStalled: vi.fn(() => ({ stalled: false })) },
        budgetSummary: vi.fn(), sonarState, askQuestion: null, task: "Fix"
      });

      expect(addCheckpointMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stage: "sonar",
          provider: "sonar",
          model: null
        })
      );
    });
  });

  describe("post-loop stages", () => {
    it("tester checkpoint includes provider and model", async () => {
      testerRunMock.mockResolvedValue({ ok: true, summary: "All tests passed" });
      const config = { roles: { tester: { provider: "claude", model: "claude/haiku" } }, session: {} };
      const session = { id: "s1", task: "Fix bug", checkpoints: [], tester_retry_count: 0 };
      const coderRole = { provider: "codex", model: "codex/o4-mini" };

      const { runTesterStage } = await import("../src/orchestrator/post-loop-stages.js");
      await runTesterStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        iteration: 1, task: "Fix bug", diff: "diff", askQuestion: null
      });

      expect(addCheckpointMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stage: "tester",
          provider: "claude",
          model: "claude/haiku"
        })
      );
    });

    it("security checkpoint includes provider and model", async () => {
      securityRunMock.mockResolvedValue({ ok: true, summary: "No vulnerabilities" });
      const config = { roles: { security: { provider: "codex", model: "codex/o3" } }, session: {} };
      const session = { id: "s1", task: "Audit", checkpoints: [], security_retry_count: 0 };
      const coderRole = { provider: "claude", model: "claude/sonnet" };

      const { runSecurityStage } = await import("../src/orchestrator/post-loop-stages.js");
      await runSecurityStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        iteration: 1, task: "Audit", diff: "diff", askQuestion: null
      });

      expect(addCheckpointMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stage: "security",
          provider: "codex",
          model: "codex/o3"
        })
      );
    });

    it("tester checkpoint falls back to coderRole when no tester config", async () => {
      testerRunMock.mockResolvedValue({ ok: true, summary: "OK" });
      const config = { roles: {}, session: {} };
      const session = { id: "s1", task: "Test", checkpoints: [], tester_retry_count: 0 };
      const coderRole = { provider: "claude", model: "claude/sonnet" };

      const { runTesterStage } = await import("../src/orchestrator/post-loop-stages.js");
      await runTesterStage({
        config, logger, emitter, eventBase, session, coderRole, trackBudget,
        iteration: 1, task: "Test", diff: "diff", askQuestion: null
      });

      expect(addCheckpointMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stage: "tester",
          provider: "claude",
          model: "claude/sonnet"
        })
      );
    });
  });
});

describe("report trace table includes Model column", () => {
  it("trace table header includes Model", () => {
    const logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const { printTraceTable } = require("../src/commands/report.js");
    const trace = [
      { index: 0, role: "coder", provider: "claude", model: "claude/sonnet", timestamp: "2026-01-01T00:00:00Z", duration_ms: 30000, tokens_in: 1000, tokens_out: 500, cost_usd: 0.5 }
    ];

    printTraceTable(trace, { currency: "usd", exchangeRate: 0.92 });

    expect(logs[0]).toContain("Model");
    const dataRow = logs[2];
    expect(dataRow).toContain("claude/sonnet");

    console.log.mockRestore();
  });

  it("trace table shows dash when model is null", () => {
    const logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const { printTraceTable } = require("../src/commands/report.js");
    const trace = [
      { index: 0, role: "sonar", provider: "sonar", model: null, timestamp: "2026-01-01T00:00:00Z", duration_ms: 5000, tokens_in: 0, tokens_out: 0, cost_usd: 0 }
    ];

    printTraceTable(trace, { currency: "usd", exchangeRate: 0.92 });

    const dataRow = logs[2];
    expect(dataRow).toContain("sonar");
    // Model column should show "-" for null
    const columns = dataRow.split(/\s{2,}/);
    expect(columns.some(col => col.trim() === "-")).toBe(true);

    console.log.mockRestore();
  });
});
