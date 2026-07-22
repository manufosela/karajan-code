import { beforeEach, describe, expect, it, vi } from "vitest";
import { enableSonarStageForSuite } from "../_fixtures/sonar-stage.js";
import { EventEmitter } from "node:events";

const REVIEW_OK = JSON.stringify({
  approved: true,
  blocking_issues: [],
  non_blocking_suggestions: [],
  summary: "OK",
  confidence: 0.9
});

vi.mock("../../src/agents/index.js", () => ({
  createAgent: vi.fn()
}));

vi.mock("../../src/session/store.js", () => {
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

vi.mock("../../src/review/diff-generator.js", () => ({
  computeBaseRef: vi.fn().mockResolvedValue("abc123"),
  getUntrackedFiles: vi.fn().mockResolvedValue([]),
  generateDiff: vi.fn().mockResolvedValue("diff content"),
  setProjectDir: vi.fn()
}));

vi.mock("../../src/review/schema.js", () => ({
  validateReviewResult: vi.fn((r) => r)
}));

vi.mock("../../src/review/tdd-policy.js", () => ({
  evaluateTddPolicy: vi.fn().mockReturnValue({
    ok: true,
    reason: "pass",
    sourceFiles: ["a.js"],
    testFiles: ["a.test.js"],
    message: "OK"
  })
}));

vi.mock("../../src/prompts/coder.js", () => ({
  buildCoderPrompt: vi.fn().mockReturnValue("coder prompt"),
  buildCoderPromptLayout: async () => ({ stable: "coder prompt", volatile: "" })
}));

vi.mock("../../src/prompts/reviewer.js", () => ({
  buildReviewerPrompt: vi.fn().mockReturnValue("reviewer prompt")
}));

vi.mock("../../src/sonar/api.js", () => ({
  getQualityGateStatus: vi.fn().mockResolvedValue({ status: "OK" }),
  getOpenIssues: vi.fn().mockResolvedValue({ total: 0, issues: [] })
}));

vi.mock("../../src/sonar/enforcer.js", () => ({
  shouldBlockByProfile: vi.fn().mockReturnValue(false),
  summarizeIssues: vi.fn().mockReturnValue("")
}));

vi.mock("../../src/utils/git.js", () => ({
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
  // Post-loop reads commit history via this helper for the summary.
  // Empty array → summary falls back to gitResult.commits.
  listCommitsBetween: vi.fn().mockResolvedValue([])
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockResolvedValue("review rules"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock("../../src/sonar/manager.js", () => ({
  sonarUp: vi.fn(),
  isSonarReachable: vi.fn().mockResolvedValue(true)
}));

vi.mock("../../src/sonar/credentials.js", () => ({
  loadSonarCredentials: vi.fn().mockResolvedValue({ user: "admin", password: "admin" })
}));

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../../src/utils/rtk-detect.js", () => ({
  detectRtk: vi.fn().mockResolvedValue({ available: false, version: null })
}));

vi.mock("../../src/skills/openskills-client.js", () => ({
  isOpenSkillsAvailable: vi.fn().mockResolvedValue(false),
  installSkill: vi.fn().mockResolvedValue({ ok: false }),
  removeSkill: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock("../../src/skills/skill-detector.js", () => ({
  detectNeededSkills: vi.fn().mockResolvedValue([]),
  autoInstallSkills: vi.fn().mockResolvedValue({ installed: [], failed: [], alreadyInstalled: [] }),
  cleanupAutoInstalledSkills: vi.fn().mockResolvedValue({ removed: [], failed: [] })
}));

vi.mock("../../src/orchestrator/preflight-checks.js", () => ({
  runPreflightChecks: vi.fn().mockResolvedValue({
    ok: true, checks: [], remediations: [], configOverrides: {}, warnings: [], errors: []
  })
}));


// KJC-BUG-0126: positional mockResolvedValueOnce chains flake when the
// orchestrator's call ORDER shifts (observed on Node 24 CI: an extra or
// reordered probe misaligns the whole chain — the scanner "fails" and
// runFlow bails with approved undefined). These mocks answer by COMMAND
// instead: they describe the world, not a fragile sequence.
function mockCommands(runCommand, overrides = {}) {
  runCommand.mockImplementation(async (cmd, args = []) => {
    const line = `${cmd} ${(args || []).join(" ")}`;
    for (const [needle, res] of Object.entries(overrides)) {
      if (line.includes(needle)) return res;
    }
    if (cmd === "git") return { exitCode: 0, stdout: "git@github.com:acme/repo.git\n", stderr: "" };
    if (cmd === "docker") return { exitCode: 0, stdout: "scan ok", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  });
}

describe("kj_run smoke", () => {
  // This file legitimately exercises the Sonar stage. Opt out of the
  // global test override (tests/setup.js sets __KJ_DISABLE_SONAR_STAGE=true
  // by default so non-sonar tests don't hit the Docker stage).
  enableSonarStageForSuite();
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KJ_SONAR_TOKEN;
  });

  it("autostarts SonarQube and scans before review when sonar service is unavailable", async () => {
    const { createAgent } = await import("../../src/agents/index.js");
    const coderAgent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }) };
    const reviewerAgent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }), reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_OK }) };
    createAgent.mockImplementation((name) => {
      if (name === "codex") return coderAgent;
      return reviewerAgent;
    });

    const { sonarUp } = await import("../../src/sonar/manager.js");
    sonarUp.mockResolvedValue({
      exitCode: 0,
      stdout: "SonarQube was unreachable and docker compose up -d was executed",
      stderr: ""
    });

    const { runCommand } = await import("../../src/utils/process.js");
    mockCommands(runCommand);

    const { runFlow } = await import("../../src/orchestrator.js");
    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e.type));

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 1,
      review_rules: "./.karajan/review-rules.md",
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
    // At least 2 calls: git config + docker scanner (journal may add git diff for tree)
    expect(runCommand.mock.calls.length).toBeGreaterThanOrEqual(2);
    const gitConfigCall = runCommand.mock.calls.find(c => c[0] === "git" && c[1]?.[0] === "config");
    expect(gitConfigCall).toBeTruthy();
    const dockerCall = runCommand.mock.calls.find(c => c[0] === "docker");
    expect(dockerCall[1]).toContain("sonarsource/sonar-scanner-cli");

    const dockerCallIndex = runCommand.mock.calls.findIndex(
      ([bin, args]) => bin === "docker" && args.includes("sonarsource/sonar-scanner-cli")
    );
    expect(dockerCallIndex).toBeGreaterThanOrEqual(0);
    expect(sonarUp.mock.invocationCallOrder[0]).toBeLessThan(runCommand.mock.invocationCallOrder[dockerCallIndex]);
    expect(runCommand.mock.invocationCallOrder[dockerCallIndex]).toBeLessThan(reviewerAgent.reviewTask.mock.invocationCallOrder[0]);

    expect(events).toContain("sonar:start");
    expect(events).toContain("sonar:end");
    expect(events.indexOf("sonar:start")).toBeLessThan(events.indexOf("sonar:end"));
    expect(events.indexOf("sonar:end")).toBeLessThan(events.indexOf("reviewer:start"));
  });

  it("autostarts SonarQube and auto-authenticates when token is not configured", async () => {
    const { createAgent } = await import("../../src/agents/index.js");
    const coderAgent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }) };
    const reviewerAgent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }), reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_OK }) };
    createAgent.mockImplementation((name) => {
      if (name === "codex") return coderAgent;
      return reviewerAgent;
    });

    const { sonarUp } = await import("../../src/sonar/manager.js");
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "started", stderr: "" });

    const { runCommand } = await import("../../src/utils/process.js");
    mockCommands(runCommand, {
      "authentication/validate": { exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" },
      "user_tokens": { exitCode: 0, stdout: JSON.stringify({ login: "admin", name: "karajan-x", token: "from-admin" }), stderr: "" },
    });

    const { runFlow } = await import("../../src/orchestrator.js");
    const emitter = new EventEmitter();
    const events = [];
    emitter.on("progress", (e) => events.push(e.type));

    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 1,
      review_rules: "./.karajan/review-rules.md",
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
    // Token passed via process env, not CLI args (invisible in ps aux)
    expect(runCommand.mock.calls[dockerCallIndex][2].env.SONAR_TOKEN).toBe("from-admin");

    expect(sonarUp.mock.invocationCallOrder[0]).toBeLessThan(runCommand.mock.invocationCallOrder[dockerCallIndex]);
    expect(validateCallIndex).toBeLessThan(tokenCallIndex);
    expect(tokenCallIndex).toBeLessThan(dockerCallIndex);
    expect(runCommand.mock.invocationCallOrder[dockerCallIndex]).toBeLessThan(reviewerAgent.reviewTask.mock.invocationCallOrder[0]);

    expect(events).toContain("sonar:start");
    expect(events).toContain("sonar:end");
    expect(events.indexOf("sonar:start")).toBeLessThan(events.indexOf("sonar:end"));
    expect(events.indexOf("sonar:end")).toBeLessThan(events.indexOf("reviewer:start"));
  });

  it("runs configured coverage command before scan when enabled", async () => {
    const { createAgent } = await import("../../src/agents/index.js");
    const coderAgent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }) };
    const reviewerAgent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "" }), reviewTask: vi.fn().mockResolvedValue({ ok: true, output: REVIEW_OK }) };
    createAgent.mockImplementation((name) => {
      if (name === "codex") return coderAgent;
      return reviewerAgent;
    });

    const { sonarUp } = await import("../../src/sonar/manager.js");
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "started", stderr: "" });

    const { runCommand } = await import("../../src/utils/process.js");
    mockCommands(runCommand, {
      "echo coverage": { exitCode: 0, stdout: "coverage ok", stderr: "" },
    });

    const { runFlow } = await import("../../src/orchestrator.js");
    const emitter = new EventEmitter();
    const config = {
      coder: "codex",
      reviewer: "claude",
      review_mode: "standard",
      max_iterations: 1,
      review_rules: "./.karajan/review-rules.md",
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
    // Calls 0 and 1 are git probes (canResolveSonarProjectKey + scanner's
    // resolveSonarProjectKey). The contract being tested is the ordering
    // of coverage→docker, which still holds — assert by content rather
    // than by absolute index so the test doesn't break when more probes
    // are added in front.
    const bashIdx = runCommand.mock.calls.findIndex(([bin]) => bin === "bash");
    const dockerIdx = runCommand.mock.calls.findIndex(([bin]) => bin === "docker");
    expect(bashIdx).toBeGreaterThanOrEqual(0);
    expect(dockerIdx).toBeGreaterThanOrEqual(0);
    expect(bashIdx).toBeLessThan(dockerIdx);
    expect(runCommand.mock.calls[bashIdx][1]).toEqual(["-lc", "echo coverage"]);
    expect(runCommand.mock.calls[0][0]).toBe("git");
  });
});
