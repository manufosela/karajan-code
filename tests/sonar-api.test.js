import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/sonar/project-key.js", () => ({
  resolveSonarProjectKey: vi.fn().mockResolvedValue("my-project")
}));

describe("sonar/api", () => {
  let getQualityGateStatus, getOpenIssues, runCommand;

  const baseConfig = {
    sonarqube: {
      host: "http://localhost:9000",
      token: "test-token"
    }
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const processMod = await import("../src/utils/process.js");
    runCommand = processMod.runCommand;
    const { resolveSonarProjectKey } = await import("../src/sonar/project-key.js");
    resolveSonarProjectKey.mockResolvedValue("my-project");
    const api = await import("../src/sonar/api.js");
    getQualityGateStatus = api.getQualityGateStatus;
    getOpenIssues = api.getOpenIssues;
  });

  describe("getQualityGateStatus", () => {
    it("returns gate status for successful response", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({ projectStatus: { status: "OK" } }) + "\n200",
        stderr: ""
      });

      const result = await getQualityGateStatus(baseConfig);
      expect(result.ok).toBe(true);
      expect(result.status).toBe("OK");
    });

    it("returns ERROR status when gate fails", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({ projectStatus: { status: "ERROR" } }) + "\n200",
        stderr: ""
      });

      const result = await getQualityGateStatus(baseConfig);
      expect(result.ok).toBe(true);
      expect(result.status).toBe("ERROR");
    });

    it("throws SonarApiError on connection failure (curl exit != 0)", async () => {
      runCommand.mockResolvedValue({
        exitCode: 7,
        stdout: "",
        stderr: "Failed to connect to localhost port 9000"
      });

      await expect(getQualityGateStatus(baseConfig)).rejects.toThrow(/not reachable/i);
    });

    it("throws SonarApiError with 401 hint on auth failure", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "Unauthorized\n401",
        stderr: ""
      });

      await expect(getQualityGateStatus(baseConfig)).rejects.toThrow(/401/);
      await expect(getQualityGateStatus(baseConfig)).rejects.toThrow(/token|auth/i);
    });

    it("throws SonarApiError on non-200 HTTP status", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "Not Found\n404",
        stderr: ""
      });

      await expect(getQualityGateStatus(baseConfig)).rejects.toThrow(/404/);
    });

    it("throws on unparseable JSON body with 200 status", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "this is not json\n200",
        stderr: ""
      });

      const result = await getQualityGateStatus(baseConfig);
      expect(result.ok).toBe(false);
      expect(result.status).toBe("ERROR");
    });

    it("includes URL in error for connection failures", async () => {
      runCommand.mockResolvedValue({
        exitCode: 7,
        stdout: "",
        stderr: "Connection refused"
      });

      await expect(getQualityGateStatus(baseConfig)).rejects.toThrow(/localhost:9000/);
    });
  });

  describe("getOpenIssues", () => {
    it("returns issues for successful response", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({ total: 2, issues: [{ key: "i1" }, { key: "i2" }] }) + "\n200",
        stderr: ""
      });

      const result = await getOpenIssues(baseConfig);
      expect(result.total).toBe(2);
      expect(result.issues).toHaveLength(2);
    });

    it("returns empty issues for successful response with no issues", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({ total: 0, issues: [] }) + "\n200",
        stderr: ""
      });

      const result = await getOpenIssues(baseConfig);
      expect(result.total).toBe(0);
      expect(result.issues).toEqual([]);
    });

    it("throws SonarApiError on connection failure", async () => {
      runCommand.mockResolvedValue({
        exitCode: 7,
        stdout: "",
        stderr: "Connection refused"
      });

      await expect(getOpenIssues(baseConfig)).rejects.toThrow(/not reachable/i);
    });

    it("throws SonarApiError on 401", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "Unauthorized\n401",
        stderr: ""
      });

      await expect(getOpenIssues(baseConfig)).rejects.toThrow(/401/);
    });

    it("returns empty on unparseable JSON body with 200", async () => {
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: "not json\n200",
        stderr: ""
      });

      const result = await getOpenIssues(baseConfig);
      expect(result.total).toBe(0);
      expect(result.issues).toEqual([]);
    });

    it("passes custom projectKey when provided", async () => {
      const { resolveSonarProjectKey } = await import("../src/sonar/project-key.js");
      runCommand.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({ total: 0, issues: [] }) + "\n200",
        stderr: ""
      });

      await getOpenIssues(baseConfig, "custom-key");
      expect(resolveSonarProjectKey).toHaveBeenCalledWith(baseConfig, { projectKey: "custom-key" });
    });
  });
});
