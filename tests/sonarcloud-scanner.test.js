import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/sonar/project-key.js", () => ({
  resolveSonarProjectKey: vi.fn().mockResolvedValue("test-project")
}));

describe("runSonarCloudScan", () => {
  let runCommand;
  const savedEnv = {};

  beforeEach(async () => {
    vi.resetAllMocks();
    savedEnv.KJ_SONARCLOUD_TOKEN = process.env.KJ_SONARCLOUD_TOKEN;
    savedEnv.KJ_SONARCLOUD_ORG = process.env.KJ_SONARCLOUD_ORG;
    delete process.env.KJ_SONARCLOUD_TOKEN;
    delete process.env.KJ_SONARCLOUD_ORG;

    const proc = await import("../src/utils/process.js");
    runCommand = proc.runCommand;
  });

  afterEach(() => {
    if (savedEnv.KJ_SONARCLOUD_TOKEN !== undefined) process.env.KJ_SONARCLOUD_TOKEN = savedEnv.KJ_SONARCLOUD_TOKEN;
    else delete process.env.KJ_SONARCLOUD_TOKEN;
    if (savedEnv.KJ_SONARCLOUD_ORG !== undefined) process.env.KJ_SONARCLOUD_ORG = savedEnv.KJ_SONARCLOUD_ORG;
    else delete process.env.KJ_SONARCLOUD_ORG;
  });

  it("fails when token is missing", async () => {
    const { runSonarCloudScan } = await import("../src/sonar/cloud-scanner.js");
    const result = await runSonarCloudScan({ sonarcloud: { organization: "org" } });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("token");
  });

  it("fails when organization is missing", async () => {
    const { runSonarCloudScan } = await import("../src/sonar/cloud-scanner.js");
    const result = await runSonarCloudScan({ sonarcloud: { token: "sqc_xxx" } });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("organization");
  });

  it("runs npx @sonar/scan with correct args", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" });

    const { runSonarCloudScan } = await import("../src/sonar/cloud-scanner.js");
    const result = await runSonarCloudScan({
      sonarcloud: {
        token: "sqc_test",
        organization: "myorg",
        project_key: "my-project",
        scanner: { sources: "src" }
      }
    });

    expect(result.ok).toBe(true);
    expect(runCommand).toHaveBeenCalledWith(
      "npx",
      expect.arrayContaining([
        "@sonar/scan",
        "-Dsonar.host.url=https://sonarcloud.io",
        "-Dsonar.projectKey=my-project",
        "-Dsonar.token=sqc_test",
        "-Dsonar.organization=myorg"
      ]),
      expect.any(Object)
    );
  });

  it("uses env vars for token and org", async () => {
    process.env.KJ_SONARCLOUD_TOKEN = "env_token";
    process.env.KJ_SONARCLOUD_ORG = "env_org";
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" });

    const { runSonarCloudScan } = await import("../src/sonar/cloud-scanner.js");
    const result = await runSonarCloudScan({ sonarcloud: { project_key: "proj" } });

    expect(result.ok).toBe(true);
    expect(runCommand).toHaveBeenCalledWith(
      "npx",
      expect.arrayContaining(["-Dsonar.token=env_token", "-Dsonar.organization=env_org"]),
      expect.any(Object)
    );
  });

  it("returns failure when scan exits non-zero", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "scan failed" });

    const { runSonarCloudScan } = await import("../src/sonar/cloud-scanner.js");
    const result = await runSonarCloudScan({
      sonarcloud: { token: "sqc_test", organization: "myorg", project_key: "proj" }
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});
