import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/sonar/scanner.js", () => ({
  runSonarScan: vi.fn()
}));

vi.mock("../src/sonar/api.js", () => ({
  getQualityGateStatus: vi.fn(),
  getOpenIssues: vi.fn()
}));

vi.mock("../src/sonar/enforcer.js", () => ({
  summarizeIssues: vi.fn()
}));

function makeConfig() {
  return {
    sonarqube: { enabled: true, host: "http://localhost:9000" }
  };
}

describe("commands/scan", () => {
  let runSonarScan, getQualityGateStatus, getOpenIssues, summarizeIssues;

  beforeEach(async () => {
    vi.resetAllMocks();

    const scanner = await import("../src/sonar/scanner.js");
    runSonarScan = scanner.runSonarScan;

    const api = await import("../src/sonar/api.js");
    getQualityGateStatus = api.getQualityGateStatus;
    getOpenIssues = api.getOpenIssues;

    const enforcer = await import("../src/sonar/enforcer.js");
    summarizeIssues = enforcer.summarizeIssues;

    runSonarScan.mockResolvedValue({ ok: true, projectKey: "my-project" });
    getQualityGateStatus.mockResolvedValue({ status: "OK" });
    getOpenIssues.mockResolvedValue({ total: 0, issues: [] });
    summarizeIssues.mockReturnValue("");
  });

  it("runs sonar scan with config", async () => {
    const { scanCommand } = await import("../src/commands/scan.js");
    const config = makeConfig();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await scanCommand({ config });
    consoleSpy.mockRestore();

    expect(runSonarScan).toHaveBeenCalledWith(config);
  });

  it("queries quality gate and issues after scan", async () => {
    const { scanCommand } = await import("../src/commands/scan.js");
    const config = makeConfig();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await scanCommand({ config });
    consoleSpy.mockRestore();

    expect(getQualityGateStatus).toHaveBeenCalledWith(config, "my-project");
    expect(getOpenIssues).toHaveBeenCalledWith(config, "my-project");
  });

  it("prints project key, quality gate status, and issue count", async () => {
    const { scanCommand } = await import("../src/commands/scan.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await scanCommand({ config: makeConfig() });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("my-project");
    expect(output).toContain("OK");
    expect(output).toContain("0");
    consoleSpy.mockRestore();
  });

  it("summarizes issues by severity", async () => {
    getOpenIssues.mockResolvedValue({ total: 3, issues: [{ severity: "MAJOR" }] });
    summarizeIssues.mockReturnValue("MAJOR: 3");

    const { scanCommand } = await import("../src/commands/scan.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await scanCommand({ config: makeConfig() });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("MAJOR: 3");
    consoleSpy.mockRestore();
  });

  it("throws when scan fails", async () => {
    runSonarScan.mockResolvedValue({ ok: false, stderr: "connection refused" });

    const { scanCommand } = await import("../src/commands/scan.js");
    await expect(scanCommand({ config: makeConfig() })).rejects.toThrow("scan failed");
  });

  it("does not query issues when scan fails", async () => {
    runSonarScan.mockResolvedValue({ ok: false, stderr: "timeout" });

    const { scanCommand } = await import("../src/commands/scan.js");
    try {
      await scanCommand({ config: makeConfig() });
    } catch { /* expected */ }

    expect(getQualityGateStatus).not.toHaveBeenCalled();
    expect(getOpenIssues).not.toHaveBeenCalled();
  });

  it("prints 'none' when no issues by severity", async () => {
    summarizeIssues.mockReturnValue("");

    const { scanCommand } = await import("../src/commands/scan.js");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await scanCommand({ config: makeConfig() });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("none");
    consoleSpy.mockRestore();
  });
});
