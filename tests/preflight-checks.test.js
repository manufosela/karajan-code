import { describe, expect, it, vi, beforeEach } from "vitest";

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

describe("preflight-checks", () => {
  let runPreflightChecks;
  let checkBinary, isSonarReachable, sonarUp, runCommand;
  let logger, emitter, eventBase;
  const emittedEvents = [];

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.KJ_SONAR_TOKEN;
    delete process.env.SONAR_TOKEN;
    delete process.env.KJ_SONAR_ADMIN_USER;
    delete process.env.KJ_SONAR_ADMIN_PASSWORD;

    emittedEvents.length = 0;

    checkBinary = (await import("../src/utils/agent-detect.js")).checkBinary;
    isSonarReachable = (await import("../src/sonar/manager.js")).isSonarReachable;
    sonarUp = (await import("../src/sonar/manager.js")).sonarUp;
    runCommand = (await import("../src/utils/process.js")).runCommand;

    // Defaults: everything works
    checkBinary.mockResolvedValue({ ok: true, version: "v1.0.0", path: "/usr/bin/docker" });
    isSonarReachable.mockResolvedValue(true);
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "OK", stderr: "" });
    runCommand.mockResolvedValue({ exitCode: 0, stdout: '{"valid":true}', stderr: "" });

    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    emitter = { emit: vi.fn((_event, data) => emittedEvents.push(data)) };
    eventBase = { sessionId: "test-session", iteration: 0, stage: null, startedAt: Date.now() };

    const mod = await import("../src/orchestrator/preflight-checks.js");
    runPreflightChecks = mod.runPreflightChecks;
  });

  function makeConfig(overrides = {}) {
    return {
      sonarqube: { enabled: true, host: "http://localhost:9000", ...overrides.sonarqube },
      roles: { security: { provider: "claude" }, coder: { provider: "claude" }, ...overrides.roles },
      coder: "claude",
      ...overrides,
    };
  }

  // --- 1. Skip when no sonar and no security ---
  it("skips all checks when sonar and security are both disabled", async () => {
    const config = makeConfig({ sonarqube: { enabled: false } });
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: false },
      securityEnabled: false,
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("skipped"));
  });

  // --- 2. Docker not available → sonar disabled ---
  it("disables sonar when Docker is not available", async () => {
    checkBinary.mockResolvedValue({ ok: false, version: "", path: "docker" });

    const config = makeConfig();
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });

    expect(result.ok).toBe(true);
    expect(result.configOverrides.sonarDisabled).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining("Docker"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Docker"));
  });

  // --- 3. SonarQube not reachable + sonarUp succeeds → OK ---
  it("auto-starts SonarQube when not reachable", async () => {
    isSonarReachable
      .mockResolvedValueOnce(false)  // first check: not reachable
      .mockResolvedValueOnce(true);  // after sonarUp: reachable
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "started", stderr: "" });

    // Mock auth check to succeed
    runCommand.mockImplementation((_cmd, args) => {
      if (args?.some?.(a => typeof a === "string" && a.includes("user_tokens/generate"))) {
        return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ token: "generated-token" }), stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" });
    });

    const config = makeConfig();
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });

    expect(result.ok).toBe(true);
    expect(result.configOverrides.sonarDisabled).toBeUndefined();
    expect(result.remediations).toContainEqual(expect.stringContaining("auto-started"));
  });

  // --- 4. SonarQube not reachable + sonarUp fails → sonar disabled ---
  it("disables sonar when SonarQube not reachable and auto-start fails", async () => {
    isSonarReachable.mockResolvedValue(false);
    sonarUp.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "failed" });

    const config = makeConfig();
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });

    expect(result.ok).toBe(true);
    expect(result.configOverrides.sonarDisabled).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining("not reachable"));
  });

  // --- 5. Auth/token invalid → sonar disabled ---
  it("disables sonar when auth fails", async () => {
    // Sonar reachable but auth fails
    runCommand.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ valid: false }), stderr: "" });

    const config = makeConfig();
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });

    expect(result.ok).toBe(true);
    expect(result.configOverrides.sonarDisabled).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining("auth failed"));
  });

  // --- 6. Auth OK + token generated → cached in env ---
  it("caches sonar token in KJ_SONAR_TOKEN when generated", async () => {
    runCommand.mockImplementation((_cmd, args) => {
      if (args?.some?.(a => typeof a === "string" && a.includes("user_tokens/generate"))) {
        return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ token: "my-generated-token" }), stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" });
    });

    const config = makeConfig();
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });

    expect(result.ok).toBe(true);
    expect(process.env.KJ_SONAR_TOKEN).toBe("my-generated-token");
    expect(result.remediations).toContainEqual(expect.stringContaining("token resolved"));
  });

  // --- 7. Security agent missing → security disabled ---
  it("disables security when agent binary not found", async () => {
    checkBinary.mockImplementation((name) => {
      if (name === "docker") return Promise.resolve({ ok: true, version: "v24.0", path: "/usr/bin/docker" });
      // Security agent not found
      return Promise.resolve({ ok: false, version: "", path: name });
    });

    const config = makeConfig({ sonarqube: { enabled: false } });
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: false },
      securityEnabled: true,
    });

    expect(result.ok).toBe(true);
    expect(result.configOverrides.securityDisabled).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining("Security agent"));
  });

  // --- 8. Everything OK → no warnings ---
  it("returns ok with no warnings when everything passes", async () => {
    runCommand.mockImplementation((_cmd, args) => {
      if (args?.some?.(a => typeof a === "string" && a.includes("user_tokens/generate"))) {
        return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ token: "tok-123" }), stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" });
    });

    const config = makeConfig();
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: true,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.configOverrides.sonarDisabled).toBeUndefined();
    expect(result.configOverrides.securityDisabled).toBeUndefined();
    expect(result.checks.length).toBeGreaterThanOrEqual(3); // docker + sonar-reachable + sonar-auth + security-agent
  });

  // --- 9. Events emitted correctly ---
  it("emits preflight:start, preflight:check, and preflight:end events", async () => {
    runCommand.mockImplementation((_cmd, args) => {
      if (args?.some?.(a => typeof a === "string" && a.includes("user_tokens/generate"))) {
        return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ token: "tok" }), stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" });
    });

    const config = makeConfig();
    await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: true,
    });

    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain("preflight:start");
    expect(eventTypes).toContain("preflight:check");
    expect(eventTypes).toContain("preflight:end");
    expect(eventTypes.filter((t) => t === "preflight:check").length).toBeGreaterThanOrEqual(3);
  });

  // --- 10. Explicit token in env is validated ---
  it("uses explicit KJ_SONAR_TOKEN if set and valid", async () => {
    process.env.KJ_SONAR_TOKEN = "explicit-token";
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "200", stderr: "" });

    const config = makeConfig();
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });

    expect(result.ok).toBe(true);
    expect(result.configOverrides.sonarDisabled).toBeUndefined();
  });

  // --- 11. External sonar skips Docker check ---
  it("skips Docker check for external SonarQube", async () => {
    checkBinary.mockResolvedValue({ ok: false, version: "", path: "docker" });

    runCommand.mockImplementation((_cmd, args) => {
      if (args?.some?.(a => typeof a === "string" && a.includes("user_tokens/generate"))) {
        return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ token: "tok" }), stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" });
    });

    const config = makeConfig({ sonarqube: { enabled: true, external: true, host: "http://sonar.example.com" } });
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });

    // Docker check should NOT have been run (external sonar)
    const dockerCheck = result.checks.find((c) => c.name === "docker");
    expect(dockerCheck).toBeUndefined();
    // Should not be disabled due to missing Docker
    expect(result.configOverrides.sonarDisabled).toBeUndefined();
  });

  // --- 12. sonarUp throws → sonar disabled ---
  it("handles sonarUp throwing an exception gracefully", async () => {
    isSonarReachable.mockResolvedValue(false);
    sonarUp.mockRejectedValue(new Error("compose file missing"));

    const config = makeConfig();
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });

    expect(result.ok).toBe(true);
    expect(result.configOverrides.sonarDisabled).toBe(true);
  });
});
