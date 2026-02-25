import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/sonar/manager.js", () => ({
  isSonarReachable: vi.fn()
}));

vi.mock("../src/sonar/project-key.js", () => ({
  resolveSonarProjectKey: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn()
}));

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" })
}));

describe("sonarOpenCommand", () => {
  let sonarOpenCommand;
  let isSonarReachable;
  let resolveSonarProjectKey;
  let loadConfig;
  let runCommand;

  const baseConfig = {
    sonarqube: { host: "http://localhost:9000", project_key: null }
  };

  beforeEach(async () => {
    vi.resetAllMocks();

    const managerMod = await import("../src/sonar/manager.js");
    isSonarReachable = managerMod.isSonarReachable;

    const pkMod = await import("../src/sonar/project-key.js");
    resolveSonarProjectKey = pkMod.resolveSonarProjectKey;

    const configMod = await import("../src/config.js");
    loadConfig = configMod.loadConfig;
    loadConfig.mockResolvedValue({ config: baseConfig });

    const procMod = await import("../src/utils/process.js");
    runCommand = procMod.runCommand;
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const mod = await import("../src/commands/sonar.js");
    sonarOpenCommand = mod.sonarOpenCommand;
  });

  it("returns dashboard URL when SonarQube is reachable", async () => {
    isSonarReachable.mockResolvedValue(true);
    resolveSonarProjectKey.mockResolvedValue("kj-my-project-abc123");

    const result = await sonarOpenCommand({ config: baseConfig });

    expect(result.ok).toBe(true);
    expect(result.url).toBe("http://localhost:9000/dashboard?id=kj-my-project-abc123");
    expect(runCommand).toHaveBeenCalled();
  });

  it("uses config host for the URL", async () => {
    const config = { sonarqube: { host: "http://sonar.example.com:9000" } };
    isSonarReachable.mockResolvedValue(true);
    resolveSonarProjectKey.mockResolvedValue("my-project");

    const result = await sonarOpenCommand({ config });

    expect(result.url).toBe("http://sonar.example.com:9000/dashboard?id=my-project");
  });

  it("returns error when SonarQube is not reachable", async () => {
    isSonarReachable.mockResolvedValue(false);

    const result = await sonarOpenCommand({ config: baseConfig });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not reachable|no está disponible/i);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns error when project key resolution fails", async () => {
    isSonarReachable.mockResolvedValue(true);
    resolveSonarProjectKey.mockRejectedValue(new Error("Missing git remote"));

    const result = await sonarOpenCommand({ config: baseConfig });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing git remote/);
  });

  it("defaults host to localhost:9000 when not configured", async () => {
    const config = { sonarqube: {} };
    isSonarReachable.mockResolvedValue(true);
    resolveSonarProjectKey.mockResolvedValue("kj-test");

    const result = await sonarOpenCommand({ config });

    expect(result.url).toBe("http://localhost:9000/dashboard?id=kj-test");
    expect(isSonarReachable).toHaveBeenCalledWith("http://localhost:9000");
  });
});
