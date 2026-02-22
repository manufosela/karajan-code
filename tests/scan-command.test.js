import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/sonar/scanner.js", () => ({
  runSonarScan: vi.fn()
}));

vi.mock("../src/sonar/api.js", () => ({
  getQualityGateStatus: vi.fn(),
  getOpenIssues: vi.fn()
}));

vi.mock("../src/sonar/enforcer.js", () => ({
  summarizeIssues: vi.fn().mockReturnValue("none")
}));

const { runSonarScan } = await import("../src/sonar/scanner.js");
const { getQualityGateStatus, getOpenIssues } = await import("../src/sonar/api.js");
const { scanCommand } = await import("../src/commands/scan.js");

describe("scanCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the scanner project key for all sonar api calls", async () => {
    const config = { sonarqube: { host: "http://localhost:9000", token: "t" } };
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    runSonarScan.mockResolvedValue({ ok: true, projectKey: "kj-acme-123", stdout: "", stderr: "" });
    getQualityGateStatus.mockResolvedValue({ status: "OK" });
    getOpenIssues.mockResolvedValue({ total: 0, issues: [] });

    await scanCommand({ config });

    expect(getQualityGateStatus).toHaveBeenCalledWith(config, "kj-acme-123");
    expect(getOpenIssues).toHaveBeenCalledWith(config, "kj-acme-123");
    expect(consoleSpy).toHaveBeenCalledWith("Project key: kj-acme-123");
    consoleSpy.mockRestore();
  });
});
