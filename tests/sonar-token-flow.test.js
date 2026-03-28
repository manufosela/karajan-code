import { describe, expect, it, vi, beforeEach } from "vitest";

// --- Mocks for preflight-checks ---

vi.mock("../src/utils/agent-detect.js", () => ({
  checkBinary: vi.fn()
}));

vi.mock("../src/sonar/manager.js", () => ({
  isSonarReachable: vi.fn(),
  sonarUp: vi.fn()
}));

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/bin/${name}`)
}));

vi.mock("../src/sonar/credentials.js", () => ({
  loadSonarCredentials: vi.fn().mockResolvedValue(null)
}));

vi.mock("../src/session-store.js", () => ({
  addCheckpoint: vi.fn(),
  markSessionStatus: vi.fn(),
  saveSession: vi.fn()
}));

describe("sonar token resolution — preflight", () => {
  let runPreflightChecks;
  let checkBinary, isSonarReachable, sonarUp, runCommand, loadSonarCredentials;
  let logger, emitter, eventBase;

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.KJ_SONAR_TOKEN;
    delete process.env.SONAR_TOKEN;
    delete process.env.KJ_SONAR_ADMIN_USER;
    delete process.env.KJ_SONAR_ADMIN_PASSWORD;

    checkBinary = (await import("../src/utils/agent-detect.js")).checkBinary;
    isSonarReachable = (await import("../src/sonar/manager.js")).isSonarReachable;
    sonarUp = (await import("../src/sonar/manager.js")).sonarUp;
    runCommand = (await import("../src/utils/process.js")).runCommand;
    loadSonarCredentials = (await import("../src/sonar/credentials.js")).loadSonarCredentials;

    checkBinary.mockResolvedValue({ ok: true, version: "v24.0", path: "/usr/bin/docker" });
    isSonarReachable.mockResolvedValue(true);
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "OK", stderr: "" });

    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
    emitter = { emit: vi.fn() };
    eventBase = { sessionId: "test", iteration: 0, stage: null, startedAt: Date.now() };

    const mod = await import("../src/orchestrator/preflight-checks.js");
    runPreflightChecks = mod.runPreflightChecks;
  });

  function makeConfig(overrides = {}) {
    return {
      sonarqube: { enabled: true, host: "http://localhost:9000", ...overrides.sonarqube },
      roles: { security: { provider: "claude" }, coder: { provider: "claude" } },
      coder: "claude",
      ...overrides,
    };
  }

  it("blocks with actionable message when sonar enabled but no token configured anywhere", async () => {
    loadSonarCredentials.mockResolvedValue(null);
    runCommand.mockResolvedValue({ exitCode: 0, stdout: '{"valid":false}', stderr: "" });

    const config = makeConfig({ sonarqube: { enabled: true } });
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });

    expect(result.ok).toBe(false);
    const authError = result.errors.find(e => e.check === "sonar-auth");
    expect(authError).toBeDefined();
    expect(authError.message).toContain("no authentication token is configured");
    expect(authError.fix).toContain("kj init");
    expect(authError.fix).toContain("KJ_SONAR_TOKEN");
    expect(authError.fix).toContain("kj.config.yml");
  });

  it("passes when sonar token is set in config", async () => {
    const config = makeConfig({ sonarqube: { enabled: true, token: "my-config-token" } });
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "200", stderr: "" });

    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });

    expect(result.ok).toBe(true);
    const authCheck = result.checks.find(c => c.name === "sonar-auth");
    expect(authCheck).toBeDefined();
    expect(authCheck.ok).toBe(true);
  });

  it("passes when KJ_SONAR_TOKEN env var is set", async () => {
    process.env.KJ_SONAR_TOKEN = "env-token-abc";
    const config = makeConfig({ sonarqube: { enabled: true } });
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "200", stderr: "" });

    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });

    expect(result.ok).toBe(true);
    const authCheck = result.checks.find(c => c.name === "sonar-auth");
    expect(authCheck.ok).toBe(true);
  });
});

describe("sonar token resolution — runSonarStage", () => {
  let logger, emitter, eventBase;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.KJ_SONAR_TOKEN;

    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
    emitter = { emit: vi.fn() };
    eventBase = { sessionId: "test", iteration: 0, stage: null, startedAt: Date.now() };
  });

  it("throws actionable error (not silent skip) when sonar is reachable but token is missing", async () => {
    const { isSonarReachable } = await import("../src/sonar/manager.js");
    isSonarReachable.mockResolvedValue(true);

    // Mock SonarRole at the role level to simulate token-missing scan failure
    vi.doMock("../src/roles/sonar-role.js", () => ({
      SonarRole: class MockSonarRole {
        constructor() {}
        async init() {}
        async run() {
          return {
            ok: false,
            result: {
              projectKey: null,
              gateStatus: null,
              issues: [],
              openIssuesTotal: 0,
              issuesSummary: "",
              blocking: false,
              error: "Unable to resolve Sonar token. Fix: (1) run 'kj init' to configure it, (2) set KJ_SONAR_TOKEN env var, or (3) add sonarqube.token to ~/.karajan/kj.config.yml."
            },
            summary: "Sonar scan failed: Unable to resolve Sonar token."
          };
        }
      }
    }));

    const { markSessionStatus } = await import("../src/session-store.js");
    const { runSonarStage } = await import("../src/orchestrator/iteration-stages.js");

    const session = {
      id: "test-session",
      last_reviewer_feedback: null,
      last_sonar_summary: null,
      sonar_retry_count: 0,
      checkpoints: [],
    };

    const config = {
      sonarqube: { enabled: true, host: "http://localhost:9000" },
      session: { fail_fast_repeats: 3 }
    };

    await expect(
      runSonarStage({
        config,
        logger,
        emitter,
        eventBase,
        session,
        trackBudget: vi.fn(),
        iteration: 1,
        repeatDetector: {
          addIteration: vi.fn(),
          isStalled: vi.fn().mockReturnValue({ stalled: false }),
          getRepeatCounts: vi.fn().mockReturnValue({ sonar: 0 })
        },
        budgetSummary: vi.fn(),
        sonarState: { issuesInitial: null, issuesFinal: null },
        askQuestion: vi.fn(),
        task: "test task",
      })
    ).rejects.toThrow(/no authentication token is configured/);

    expect(markSessionStatus).toHaveBeenCalledWith(session, "failed");

    // Verify the emitted event contains the actionable message
    const sonarEndCall = emitter.emit.mock.calls.find(
      ([, data]) => data?.type === "sonar:end"
    );
    expect(sonarEndCall).toBeDefined();
    const eventData = sonarEndCall[1];
    expect(eventData.message).toContain("kj init");
    expect(eventData.message).toContain("KJ_SONAR_TOKEN");
  });
});
