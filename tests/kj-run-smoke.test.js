import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const REVIEW_OK = JSON.stringify({
  approved: true,
  blocking_issues: [],
  non_blocking_suggestions: [],
  summary: "OK",
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
        id: "s_smoke",
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

vi.mock("../src/sonar/manager.js", () => ({
  sonarUp: vi.fn()
}));

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

describe("kj_run smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KJ_SONAR_TOKEN;
  });

  it("autostarts SonarQube and scans before review when sonar service is unavailable", async () => {
    const { createAgent } = await import("../src/agents/index.js");
    const coderAgent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }) };
    const reviewerAgent = { reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_OK }) };
    createAgent.mockImplementation((name) => {
      if (name === "codex") return coderAgent;
      return reviewerAgent;
    });

    const { sonarUp } = await import("../src/sonar/manager.js");
    sonarUp.mockResolvedValue({
      exitCode: 0,
      stdout: "SonarQube was unreachable and docker compose up -d was executed",
      stderr: ""
    });

    const { runCommand } = await import("../src/utils/process.js");
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "scan ok", stderr: "" });

    const { runFlow } = await import("../src/orchestrator.js");
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
      sonarqube: { enabled: true, host: "http://localhost:9000", token: "token-123", scanner: { sources: "src" } },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      setContext: vi.fn(), resetContext: vi.fn()
    };

    const result = await runFlow({ task: "smoke test", config, logger, flags: {}, emitter });

    expect(result.approved).toBe(true);
    expect(sonarUp).toHaveBeenCalledWith("http://localhost:9000");
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand.mock.calls[0][0]).toBe("docker");
    expect(runCommand.mock.calls[0][1]).toContain("sonarsource/sonar-scanner-cli");

    expect(sonarUp.mock.invocationCallOrder[0]).toBeLessThan(runCommand.mock.invocationCallOrder[0]);
    expect(runCommand.mock.invocationCallOrder[0]).toBeLessThan(reviewerAgent.reviewTask.mock.invocationCallOrder[0]);

    expect(events).toContain("sonar:start");
    expect(events).toContain("sonar:end");
    expect(events.indexOf("sonar:start")).toBeLessThan(events.indexOf("sonar:end"));
    expect(events.indexOf("sonar:end")).toBeLessThan(events.indexOf("reviewer:start"));
  });

  it("autostarts SonarQube and auto-authenticates when token is not configured", async () => {
    const { createAgent } = await import("../src/agents/index.js");
    const coderAgent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }) };
    const reviewerAgent = { reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_OK }) };
    createAgent.mockImplementation((name) => {
      if (name === "codex") return coderAgent;
      return reviewerAgent;
    });

    const { sonarUp } = await import("../src/sonar/manager.js");
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "started", stderr: "" });

    const { runCommand } = await import("../src/utils/process.js");
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ login: "admin", name: "karajan-x", token: "from-admin" }),
        stderr: ""
      })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "scan ok", stderr: "" });

    const { runFlow } = await import("../src/orchestrator.js");
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
      sonarqube: { enabled: true, host: "http://localhost:9000", token: null, scanner: { sources: "src" } },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      setContext: vi.fn(), resetContext: vi.fn()
    };

    const result = await runFlow({ task: "smoke test", config, logger, flags: {}, emitter });

    expect(result.approved).toBe(true);
    expect(sonarUp).toHaveBeenCalledWith("http://localhost:9000");

    const validateCallIndex = runCommand.mock.calls.findIndex(
      ([bin, args]) => bin === "curl" && args.includes("http://localhost:9000/api/authentication/validate")
    );
    const tokenCallIndex = runCommand.mock.calls.findIndex(
      ([bin, args]) => bin === "curl" && args.includes("http://localhost:9000/api/user_tokens/generate")
    );
    const dockerCallIndex = runCommand.mock.calls.findIndex(
      ([bin, args]) => bin === "docker" && args.includes("sonarsource/sonar-scanner-cli")
    );
    expect(validateCallIndex).toBeGreaterThanOrEqual(0);
    expect(tokenCallIndex).toBeGreaterThanOrEqual(0);
    expect(dockerCallIndex).toBeGreaterThanOrEqual(0);
    expect(runCommand.mock.calls[dockerCallIndex][1]).toContain("SONAR_TOKEN=from-admin");

    expect(sonarUp.mock.invocationCallOrder[0]).toBeLessThan(runCommand.mock.invocationCallOrder[0]);
    expect(validateCallIndex).toBeLessThan(tokenCallIndex);
    expect(tokenCallIndex).toBeLessThan(dockerCallIndex);
    expect(runCommand.mock.invocationCallOrder[dockerCallIndex]).toBeLessThan(reviewerAgent.reviewTask.mock.invocationCallOrder[0]);

    expect(events).toContain("sonar:start");
    expect(events).toContain("sonar:end");
    expect(events.indexOf("sonar:start")).toBeLessThan(events.indexOf("sonar:end"));
    expect(events.indexOf("sonar:end")).toBeLessThan(events.indexOf("reviewer:start"));
  });

  it("runs configured coverage command before scan when enabled", async () => {
    const { createAgent } = await import("../src/agents/index.js");
    const coderAgent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }) };
    const reviewerAgent = { reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_OK }) };
    createAgent.mockImplementation((name) => {
      if (name === "codex") return coderAgent;
      return reviewerAgent;
    });

    const { sonarUp } = await import("../src/sonar/manager.js");
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "started", stderr: "" });

    const { runCommand } = await import("../src/utils/process.js");
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: "coverage ok", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "scan ok", stderr: "" });

    const { runFlow } = await import("../src/orchestrator.js");
    const emitter = new EventEmitter();
    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 1,
      review_rules: "./review-rules.md",
      base_branch: "main",
      development: { methodology: "tdd", require_test_changes: true },
      sonarqube: {
        enabled: true,
        host: "http://localhost:9000",
        token: "token-123",
        coverage: {
          enabled: true,
          command: "echo coverage",
          timeout_ms: 1000,
          block_on_failure: true,
          lcov_report_path: "package.json"
        },
        scanner: { sources: "src" }
      },
      git: { auto_commit: false, auto_push: false, auto_pr: false },
      session: { max_total_minutes: 120, fail_fast_repeats: 2 },
      reviewer_options: { retries: 0, fallback_reviewer: null },
      output: { log_level: "info" }
    };

    const logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      setContext: vi.fn(), resetContext: vi.fn()
    };

    const result = await runFlow({ task: "smoke test", config, logger, flags: {}, emitter });

    expect(result.approved).toBe(true);
    expect(runCommand.mock.calls[0][0]).toBe("/bin/bash");
    expect(runCommand.mock.calls[0][1]).toEqual(["-lc", "echo coverage"]);
    expect(runCommand.mock.calls[1][0]).toBe("docker");
  });
});
