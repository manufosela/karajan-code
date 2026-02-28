import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const REVIEW_APPROVED = JSON.stringify({
  approved: true,
  blocking_issues: [],
  non_blocking_suggestions: [],
  summary: "OK",
  confidence: 0.95
});

const triageRunMock = vi.fn();
const researcherRunMock = vi.fn();
const testerRunMock = vi.fn();
const securityRunMock = vi.fn();

vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn((name) => {
    if (name === "codex") {
      return {
        runTask: vi.fn().mockResolvedValue({ ok: true, output: "", usage: { tokens_in: 200, tokens_out: 100 } })
      };
    }

    return {
      runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }),
      reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_APPROVED, usage: { tokens_in: 50, tokens_out: 40 } })
    };
  })
}));

vi.mock("../src/roles/sonar-role.js", () => ({
  SonarRole: class {
    async init() {}
    async run() {
      return {
        ok: true,
        summary: "Sonar passed",
        result: { gateStatus: "OK", blocking: false, openIssuesTotal: 0, projectKey: "k" }
      };
    }
  }
}));

vi.mock("../src/roles/triage-role.js", () => ({
  TriageRole: class {
    async init() {}
    async run() {
      return triageRunMock();
    }
  }
}));

vi.mock("../src/roles/researcher-role.js", () => ({
  ResearcherRole: class {
    async init() {}
    async run() {
      return researcherRunMock();
    }
  }
}));

vi.mock("../src/roles/tester-role.js", () => ({
  TesterRole: class {
    async init() {}
    async run() {
      return testerRunMock();
    }
  }
}));

vi.mock("../src/roles/security-role.js", () => ({
  SecurityRole: class {
    async init() {}
    async run() {
      return securityRunMock();
    }
  }
}));

vi.mock("../src/session-store.js", () => {
  let session = null;
  return {
    createSession: vi.fn(async (initial) => {
      session = { id: "s_triage", status: "running", checkpoints: [], ...initial };
      return session;
    }),
    saveSession: vi.fn(async () => {}),
    loadSession: vi.fn(async () => session),
    addCheckpoint: vi.fn(async (s, cp) => s.checkpoints.push(cp)),
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
  generateDiff: vi.fn().mockResolvedValue("diff")
}));

vi.mock("../src/review/schema.js", () => ({ validateReviewResult: vi.fn((r) => r) }));
vi.mock("../src/review/parser.js", () => ({ parseJsonOutput: vi.fn((s) => JSON.parse(s)) }));
vi.mock("../src/review/tdd-policy.js", () => ({
  evaluateTddPolicy: vi.fn().mockReturnValue({ ok: true, reason: "pass", sourceFiles: ["a.js"], testFiles: ["a.test.js"], message: "OK" })
}));
vi.mock("../src/prompts/coder.js", () => ({ buildCoderPrompt: vi.fn().mockReturnValue("coder prompt") }));
vi.mock("../src/prompts/reviewer.js", () => ({ buildReviewerPrompt: vi.fn().mockReturnValue("reviewer prompt") }));
vi.mock("../src/review/profiles.js", () => ({ resolveReviewProfile: vi.fn().mockResolvedValue({ rules: "rules" }) }));
vi.mock("../src/git/automation.js", () => ({
  commitMessageFromTask: vi.fn(),
  prepareGitAutomation: vi.fn().mockResolvedValue({}),
  finalizeGitAutomation: vi.fn().mockResolvedValue({ committed: false, pushed: false, pr: null, branch: null, commits: [] })
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockResolvedValue("rules"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
  }
}));

describe("orchestrator triage pipeline", () => {
  let runFlow;
  let createAgent;

  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    setContext: vi.fn(), resetContext: vi.fn()
  };

  const baseConfig = {
    coder: "codex",
    reviewer: "claude",
    roles: {
      coder: { provider: "codex", model: null },
      reviewer: { provider: "claude", model: null },
      planner: { provider: "claude", model: null },
      refactorer: { provider: "claude", model: null },
      researcher: { provider: "claude", model: null },
      tester: { provider: "claude", model: null },
      security: { provider: "claude", model: null },
      triage: { provider: "claude", model: null }
    },
    pipeline: {
      triage: { enabled: true },
      planner: { enabled: true },
      refactorer: { enabled: true },
      researcher: { enabled: true },
      tester: { enabled: true },
      security: { enabled: true },
      reviewer: { enabled: true }
    },
    review_mode: "standard",
    max_iterations: 1,
    review_rules: "./review-rules.md",
    base_branch: "main",
    development: { methodology: "tdd", require_test_changes: true },
    sonarqube: { enabled: true },
    git: { auto_commit: false, auto_push: false, auto_pr: false },
    session: { max_total_minutes: 120, fail_fast_repeats: 2, max_reviewer_retries: 1, max_tester_retries: 1, max_security_retries: 1 },
    reviewer_options: { retries: 0, fallback_reviewer: null },
    output: { log_level: "info" }
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    triageRunMock.mockResolvedValue({
      ok: true,
      result: { level: "trivial", roles: [], reasoning: "Tiny task" },
      usage: { tokens_in: 100, tokens_out: 80, cost_usd: 0.001 }
    });
    researcherRunMock.mockResolvedValue({ ok: true, summary: "research", result: {} });
    testerRunMock.mockResolvedValue({ ok: true, summary: "tests" });
    securityRunMock.mockResolvedValue({ ok: true, summary: "secure" });

    ({ runFlow } = await import("../src/orchestrator.js"));
    ({ createAgent } = await import("../src/agents/index.js"));
    const { resolveReviewProfile } = await import("../src/review/profiles.js");
    resolveReviewProfile.mockResolvedValue({ rules: "rules" });
    const { evaluateTddPolicy } = await import("../src/review/tdd-policy.js");
    evaluateTddPolicy.mockReturnValue({
      ok: true,
      reason: "pass",
      sourceFiles: ["a.js"],
      testFiles: ["a.test.js"],
      message: "OK"
    });
  });

  it("trivial task runs only coder + sonar (without reviewer)", async () => {
    const result = await runFlow({ task: "tiny", config: baseConfig, logger, flags: {} });

    expect(result.approved).toBe(true);
    const agents = createAgent.mock.calls.map((call) => call[0]);
    expect(agents.filter((a) => a === "codex")).toHaveLength(1);
    expect(agents.filter((a) => a === "claude")).toHaveLength(0);
    expect(researcherRunMock).not.toHaveBeenCalled();
    expect(testerRunMock).not.toHaveBeenCalled();
    expect(securityRunMock).not.toHaveBeenCalled();
  });

  it("medium task enables reviewer", async () => {
    triageRunMock.mockResolvedValueOnce({
      ok: true,
      result: { level: "medium", roles: ["reviewer"], reasoning: "Moderate complexity" },
      usage: { tokens_in: 90, tokens_out: 70 }
    });

    const result = await runFlow({ task: "medium", config: baseConfig, logger, flags: {} });
    expect(result.approved).toBe(true);

    const agents = createAgent.mock.calls.map((call) => call[0]);
    expect(agents.filter((a) => a === "claude")).toHaveLength(1);
  });

  it("complex task activates full optional pipeline", async () => {
    triageRunMock.mockResolvedValueOnce({
      ok: true,
      result: {
        level: "complex",
        roles: ["planner", "researcher", "refactorer", "reviewer", "tester", "security"],
        reasoning: "High complexity"
      },
      usage: { tokens_in: 120, tokens_out: 100 }
    });

    const result = await runFlow({ task: "complex", config: baseConfig, logger, flags: {} });
    expect(result.approved).toBe(true);
    expect(researcherRunMock).toHaveBeenCalledTimes(1);
    expect(testerRunMock).toHaveBeenCalledTimes(1);
    expect(securityRunMock).toHaveBeenCalledTimes(1);
  });

  it("manual flags prevail over triage decisions", async () => {
    triageRunMock.mockResolvedValueOnce({
      ok: true,
      result: { level: "trivial", roles: [], reasoning: "Tiny task" },
      usage: { tokens_in: 80, tokens_out: 60 }
    });

    const result = await runFlow({
      task: "force-review",
      config: baseConfig,
      logger,
      flags: { enableReviewer: true }
    });

    expect(result.approved).toBe(true);
    const agents = createAgent.mock.calls.map((call) => call[0]);
    expect(agents.filter((a) => a === "claude")).toHaveLength(1);
  });

  it("registers triage budget usage under 500 tokens", async () => {
    triageRunMock.mockResolvedValueOnce({
      ok: true,
      result: { level: "simple", roles: ["reviewer"], reasoning: "Low risk" },
      usage: { tokens_in: 200, tokens_out: 100, cost_usd: 0.002 }
    });

    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (event) => events.push(event));

    const result = await runFlow({ task: "budget", config: baseConfig, logger, flags: {}, emitter });
    expect(result.approved).toBe(true);

    const endEvent = events.filter((e) => e.type === "session:end").at(-1);
    const triageBudget = endEvent?.detail?.budget?.breakdown_by_role?.triage;

    expect(triageBudget).toBeTruthy();
    expect(triageBudget.total_tokens).toBe(300);
    expect(triageBudget.total_tokens).toBeLessThan(500);
  });
});
