import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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
  loadSonarCredentials: vi.fn().mockResolvedValue({ user: "admin", password: "testpass" })
}));

// Commit 6 of KJC-TSK-0319: preflight now also runs doctor-style extended
// checks. Stub their IO so the existing tests keep their Sonar/security
// focus without accidentally failing on unrelated environment issues.
vi.mock("../src/utils/port-check.js", () => ({
  isPortAvailable: vi.fn().mockResolvedValue(true),
  findAvailablePort: vi.fn().mockResolvedValue(4001)
}));

vi.mock("../src/utils/port-occupant.js", () => ({
  getPortOccupant: vi.fn().mockResolvedValue(null)
}));

// KJC-TSK-0393: project-aware checks are integrated into preflight extended
// phase, but in this test suite we mock everything (no real projectDir, no
// real git remote). Mock the project-checks module to return [] so these
// existing tests assertions about warnings count stay accurate.
vi.mock("../src/checks/project-checks.js", () => ({
  getProjectChecks: vi.fn(() => []),
  detectProjectSignals: vi.fn(() => new Set()),
}));

vi.mock("../src/skills/openskills-client.js", () => ({
  isOpenSkillsAvailable: vi.fn().mockResolvedValue(true)
}));

vi.mock("node:fs/promises", () => ({
  default: {
    stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
    writeFile: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock("node:child_process", () => {
  const { EventEmitter } = require("node:events");
  return {
    spawn: vi.fn(() => {
      const child = new EventEmitter();
      child.stdin = { write: vi.fn() };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.unref = vi.fn();
      setImmediate(() => child.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}\n')));
      return child;
    })
  };
});

describe("preflight-checks", () => {
  let runPreflightChecks;
  let checkBinary, isSonarReachable, sonarUp, runCommand;
  let logger, emitter, eventBase;
  const emittedEvents = [];

  const savedEnv = { ...process.env };
  // This file legitimately exercises the Sonar preflight (auto-start,
  // reachability, token auth). Opt out of the global test override
  // (tests/setup.js disables sonar by default for non-sonar tests).
  const prevSonarDisabled = globalThis.__KJ_DISABLE_SONAR_STAGE;
  afterEach(() => { globalThis.__KJ_DISABLE_SONAR_STAGE = prevSonarDisabled; });

  beforeEach(async () => {
    globalThis.__KJ_DISABLE_SONAR_STAGE = false;
    vi.resetAllMocks();
    delete process.env.KJ_SONAR_TOKEN;
    delete process.env.SONAR_TOKEN;
    delete process.env.KJ_SONAR_ADMIN_USER;
    delete process.env.KJ_SONAR_ADMIN_PASSWORD;

    // Satisfy the token check for active providers used by makeConfig().
    process.env.ANTHROPIC_API_KEY = "sk-test-preflight";

    emittedEvents.length = 0;

    checkBinary = (await import("../src/utils/agent-detect.js")).checkBinary;
    isSonarReachable = (await import("../src/sonar/manager.js")).isSonarReachable;
    sonarUp = (await import("../src/sonar/manager.js")).sonarUp;
    runCommand = (await import("../src/utils/process.js")).runCommand;

    checkBinary.mockResolvedValue({ ok: true, version: "v1.0.0", path: "/usr/bin/docker" });
    isSonarReachable.mockResolvedValue(true);
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "OK", stderr: "" });
    runCommand.mockResolvedValue({ exitCode: 0, stdout: '{"valid":true}', stderr: "" });

    const { loadSonarCredentials } = await import("../src/sonar/credentials.js");
    loadSonarCredentials.mockResolvedValue({ user: "admin", password: "testpass" });

    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    emitter = { emit: vi.fn((_event, data) => emittedEvents.push(data)) };
    eventBase = { sessionId: "test-session", iteration: 0, stage: null, startedAt: Date.now() };

    // Restore default happy-path mocks for the extended checks (they were
    // reset by vi.resetAllMocks).
    const portCheck = await import("../src/utils/port-check.js");
    portCheck.isPortAvailable.mockResolvedValue(true);
    portCheck.findAvailablePort.mockResolvedValue(4001);

    const skillsClient = await import("../src/skills/openskills-client.js");
    skillsClient.isOpenSkillsAvailable.mockResolvedValue(true);

    const fsPromises = (await import("node:fs/promises")).default;
    fsPromises.stat.mockResolvedValue({ isDirectory: () => true });
    fsPromises.mkdir.mockResolvedValue(undefined);
    fsPromises.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    const cp = await import("node:child_process");
    cp.spawn.mockImplementation(() => {
      const { EventEmitter } = require("node:events");
      const child = new EventEmitter();
      child.stdin = { write: vi.fn() };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.unref = vi.fn();
      setImmediate(() => child.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}\n')));
      return child;
    });

    const mod = await import("../src/orchestrator/preflight-checks.js");
    runPreflightChecks = mod.runPreflightChecks;
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
  });

  function makeConfig(overrides = {}) {
    return {
      sonarqube: { enabled: true, host: "http://localhost:9000", ...overrides.sonarqube },
      roles: { security: { provider: "claude" }, coder: { provider: "claude" }, ...overrides.roles },
      coder: "claude",
      // The test suite globally defaults extended preflight OFF (see
      // tests/setup.js). The preflight-checks test explicitly wants the
      // extended checks to run so we can assert their behavior.
      preflight: { extended: true, ...overrides.preflight },
      ...overrides,
    };
  }

  it("runs only extended (doctor-style) checks when sonar and security are both disabled", async () => {
    const config = makeConfig({ sonarqube: { enabled: false } });
    const result = await runPreflightChecks({
      config, logger, emitter, eventBase,
      resolvedPolicies: { sonar: false },
      securityEnabled: false,
    });
    expect(result.ok).toBe(true);
    // No Sonar/docker/security entries, but extended checks are still present.
    const names = result.checks.map((c) => c.name);
    expect(names).not.toContain("docker");
    expect(names).not.toContain("sonar-reachable");
    expect(names).not.toContain("security-agent");
    expect(names).toContain("node-version");
    // Happy-path default mocks should keep things green.
    expect(result.warnings).toHaveLength(0);
  });

  it("hard fails when Docker is not available and sonar is enabled", async () => {
    checkBinary.mockResolvedValue({ ok: false, version: "", path: "docker" });
    const result = await runPreflightChecks({
      config: makeConfig(), logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ check: "docker" }));
  });

  it("auto-starts SonarQube when not reachable", async () => {
    isSonarReachable.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "started", stderr: "" });
    runCommand.mockImplementation((_cmd, args) => {
      if (args?.some?.(a => typeof a === "string" && a.includes("user_tokens/generate"))) {
        return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ token: "generated-token" }), stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" });
    });
    const result = await runPreflightChecks({
      config: makeConfig(), logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });
    expect(result.ok).toBe(true);
    expect(result.configOverrides.sonarDisabled).toBeUndefined();
    expect(result.remediations).toContainEqual(expect.stringContaining("auto-started"));
  });

  it("hard fails when SonarQube not reachable and auto-start fails", async () => {
    isSonarReachable.mockResolvedValue(false);
    sonarUp.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "failed" });
    const result = await runPreflightChecks({
      config: makeConfig(), logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ check: "sonar-reachable" }));
  });

  it("hard fails when sonar auth fails", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ valid: false }), stderr: "" });
    const result = await runPreflightChecks({
      config: makeConfig(), logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ check: "sonar-auth" }));
  });

  it("caches sonar token in KJ_SONAR_TOKEN when generated", async () => {
    runCommand.mockImplementation((_cmd, args) => {
      if (args?.some?.(a => typeof a === "string" && a.includes("user_tokens/generate"))) {
        return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ token: "my-token" }), stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" });
    });
    const result = await runPreflightChecks({
      config: makeConfig(), logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });
    expect(process.env.KJ_SONAR_TOKEN).toBe("my-token");
    expect(result.remediations).toContainEqual(expect.stringContaining("token resolved"));
  });

  it("disables security when agent binary not found", async () => {
    checkBinary.mockImplementation((name) => {
      if (name === "docker") return Promise.resolve({ ok: true, version: "v24.0", path: "/usr/bin/docker" });
      return Promise.resolve({ ok: false, version: "", path: name });
    });
    const result = await runPreflightChecks({
      config: makeConfig({ sonarqube: { enabled: false } }), logger, emitter, eventBase,
      resolvedPolicies: { sonar: false },
      securityEnabled: true,
    });
    expect(result.configOverrides.securityDisabled).toBe(true);
  });

  it("returns ok with no warnings when everything passes", async () => {
    runCommand.mockImplementation((_cmd, args) => {
      if (args?.some?.(a => typeof a === "string" && a.includes("user_tokens/generate"))) {
        return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ token: "tok" }), stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" });
    });
    const result = await runPreflightChecks({
      config: makeConfig(), logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: true,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.checks.length).toBeGreaterThanOrEqual(3);
  });

  it("emits preflight:start, preflight:check, and preflight:end events", async () => {
    runCommand.mockImplementation((_cmd, args) => {
      if (args?.some?.(a => typeof a === "string" && a.includes("user_tokens/generate"))) {
        return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ token: "tok" }), stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" });
    });
    await runPreflightChecks({
      config: makeConfig(), logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: true,
    });
    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain("preflight:start");
    expect(eventTypes).toContain("preflight:check");
    expect(eventTypes).toContain("preflight:end");
  });

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
    const dockerCheck = result.checks.find((c) => c.name === "docker");
    expect(dockerCheck).toBeUndefined();
    expect(result.configOverrides.sonarDisabled).toBeUndefined();
  });

  it("hard fails when sonarUp throws an exception", async () => {
    isSonarReachable.mockResolvedValue(false);
    sonarUp.mockRejectedValue(new Error("compose file missing"));
    const result = await runPreflightChecks({
      config: makeConfig(), logger, emitter, eventBase,
      resolvedPolicies: { sonar: true },
      securityEnabled: false,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ check: "sonar-reachable" }));
  });
});
