import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" })
}));

vi.mock("../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/bin/${name}`)
}));

vi.mock("../src/utils/fs.js", () => ({
  exists: vi.fn().mockResolvedValue(true),
  ensureDir: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  getConfigPath: vi.fn().mockReturnValue("/home/user/.karajan/kj.config.yml"),
  loadConfig: vi.fn(),
  applyRunOverrides: vi.fn(),
  validateConfig: vi.fn(),
  resolveRole: vi.fn()
}));

vi.mock("../src/sonar/manager.js", () => ({
  isSonarReachable: vi.fn().mockResolvedValue(true)
}));

vi.mock("../src/roles/base-role.js", () => ({
  resolveRoleMdPath: vi.fn().mockReturnValue(["/fake/reviewer.md"]),
  loadFirstExisting: vi.fn().mockResolvedValue("rules content")
}));

vi.mock("../src/utils/git.js", () => ({
  ensureGitRepo: vi.fn().mockResolvedValue(true)
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
    access: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock("../src/proxy/proxy-lifecycle.js", () => ({
  isProxyRunning: vi.fn().mockResolvedValue(false),
  getProxyStats: vi.fn().mockReturnValue(null)
}));

vi.mock("../src/utils/run-log.js", () => ({
  readRunLog: vi.fn().mockReturnValue({ lines: [] })
}));

vi.mock("../src/session-store.js", () => ({
  loadMostRecentSession: vi.fn().mockResolvedValue(null)
}));

vi.mock("../src/utils/status-dashboard.js", () => ({
  buildDashboard: vi.fn().mockReturnValue("No active pipeline")
}));

const baseConfig = {
  review_mode: "standard",
  sonarqube: { enabled: true, host: "http://localhost:9000" }
};

async function setupDoctorMocks() {
  const { runCommand } = await import("../src/utils/process.js");
  runCommand.mockResolvedValue({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });

  const { exists } = await import("../src/utils/fs.js");
  exists.mockResolvedValue(true);

  const { isSonarReachable } = await import("../src/sonar/manager.js");
  isSonarReachable.mockResolvedValue(true);

  const { ensureGitRepo } = await import("../src/utils/git.js");
  ensureGitRepo.mockResolvedValue(true);

  const { loadFirstExisting } = await import("../src/roles/base-role.js");
  loadFirstExisting.mockResolvedValue("rules content");

  const fsPromises = await import("node:fs/promises");
  fsPromises.default.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
}

describe("proxy-diagnostics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  describe("doctor proxy check", () => {
    it("shows proxy MISS when not running", async () => {
      await setupDoctorMocks();
      const { isProxyRunning } = await import("../src/proxy/proxy-lifecycle.js");
      isProxyRunning.mockResolvedValue(false);

      const { runChecks } = await import("../src/commands/doctor.js");
      const checks = await runChecks({ config: baseConfig });
      const proxy = checks.find((c) => c.name === "proxy");

      expect(proxy).toBeDefined();
      expect(proxy.ok).toBe(true);
      expect(proxy.detail).toBe("Available (starts on kj run)");
    });

    it("shows proxy OK when running", async () => {
      await setupDoctorMocks();
      const { isProxyRunning } = await import("../src/proxy/proxy-lifecycle.js");
      isProxyRunning.mockResolvedValue(true);

      const { runChecks } = await import("../src/commands/doctor.js");
      const checks = await runChecks({ config: baseConfig });
      const proxy = checks.find((c) => c.name === "proxy");

      expect(proxy).toBeDefined();
      expect(proxy.ok).toBe(true);
      expect(proxy.detail).toBe("Running");
    });

    it("shows disabled when proxy.enabled is false", async () => {
      await setupDoctorMocks();
      const { runChecks } = await import("../src/commands/doctor.js");
      const checks = await runChecks({ config: { ...baseConfig, proxy: { enabled: false } } });
      const proxy = checks.find((c) => c.name === "proxy");

      expect(proxy).toBeDefined();
      expect(proxy.ok).toBe(true);
      expect(proxy.detail).toBe("Disabled in config");
    });
  });

  describe("status proxy info", () => {
    it("shows proxy stats when proxy is running", async () => {
      const { getProxyStats } = await import("../src/proxy/proxy-lifecycle.js");
      getProxyStats.mockReturnValue({ port: 12345, requests: 10, bytes_in: 5000, bytes_out: 3000 });

      const { readRunLog } = await import("../src/utils/run-log.js");
      readRunLog.mockReturnValue({ lines: [] });

      const { statusCommand } = await import("../src/commands/status.js");
      await statusCommand({ projectDir: "/tmp/fake" });

      const calls = console.log.mock.calls.map((c) => c[0]);
      const proxyLine = calls.find((l) => typeof l === "string" && l.includes("Proxy:"));
      expect(proxyLine).toContain("port 12345");
      expect(proxyLine).toContain("10 requests");
    });

    it("does not show proxy line when proxy is not running", async () => {
      const { getProxyStats } = await import("../src/proxy/proxy-lifecycle.js");
      getProxyStats.mockReturnValue(null);

      const { readRunLog } = await import("../src/utils/run-log.js");
      readRunLog.mockReturnValue({ lines: [] });

      const { statusCommand } = await import("../src/commands/status.js");
      await statusCommand({ projectDir: "/tmp/fake" });

      const calls = console.log.mock.calls.map((c) => c[0]);
      const proxyLine = calls.find((l) => typeof l === "string" && l.includes("Proxy:"));
      expect(proxyLine).toBeUndefined();
    });
  });
});
