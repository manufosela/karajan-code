import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/sonar/manager.js", () => ({
  sonarUp: vi.fn()
}));

const { runCommand } = await import("../src/utils/process.js");
const { sonarUp } = await import("../src/sonar/manager.js");
const { runSonarScan } = await import("../src/sonar/scanner.js");

const baseConfig = {
  sonarqube: {
    host: "http://localhost:9000",
    token: "token-123",
    admin_user: "admin",
    admin_password: null,
    scanner: { sources: "src" }
  }
};

describe("runSonarScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KJ_SONAR_TOKEN;
  });

  it("starts SonarQube service before running scanner", async () => {
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" });

    const result = await runSonarScan(baseConfig, "my-key");

    expect(sonarUp).toHaveBeenCalledWith("http://localhost:9000");
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand.mock.calls[0][0]).toBe("docker");
    expect(result.ok).toBe(true);
  });

  it("fails immediately when SonarQube service cannot be started", async () => {
    sonarUp.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "docker unavailable" });

    const result = await runSonarScan(baseConfig, "my-key");

    expect(runCommand).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("docker unavailable");
  });

  it("falls back to admin/admin when no token is configured", async () => {
    const config = {
      sonarqube: {
        host: "http://localhost:9000",
        token: null,
        admin_user: "admin",
        admin_password: null,
        scanner: { sources: "src" }
      }
    };
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ login: "admin", name: "karajan-x", token: "from-admin" }),
        stderr: ""
      })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "scan ok", stderr: "" });

    const result = await runSonarScan(config, "my-key");

    expect(result.ok).toBe(true);
    expect(runCommand.mock.calls[0][0]).toBe("curl");
    expect(runCommand.mock.calls[1][0]).toBe("curl");
    expect(runCommand.mock.calls[2][0]).toBe("docker");
    expect(runCommand.mock.calls[2][1]).toContain("SONAR_TOKEN=from-admin");
    expect(process.env.KJ_SONAR_TOKEN).toBe("from-admin");
  });

  it("tries configured admin password before admin/admin", async () => {
    const config = {
      sonarqube: {
        host: "http://localhost:9000",
        token: null,
        admin_user: "admin",
        admin_password: "otherpass",
        scanner: { sources: "src" }
      }
    };
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ valid: false }), stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ valid: true }), stderr: "" })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ login: "admin", name: "karajan-x", token: "from-default" }),
        stderr: ""
      })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "scan ok", stderr: "" });

    const result = await runSonarScan(config, "my-key");

    expect(result.ok).toBe(true);
    expect(runCommand.mock.calls[0][1]).toContain("admin:otherpass");
    expect(runCommand.mock.calls[1][1]).toContain("admin:admin");
    expect(runCommand.mock.calls[3][1]).toContain("SONAR_TOKEN=from-default");
  });

  it("filters non-existing scanner source folders to avoid Sonar scan failure", async () => {
    const config = {
      sonarqube: {
        host: "http://localhost:9000",
        token: "token-123",
        scanner: { sources: "src,public,lib" }
      }
    };
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" });

    const result = await runSonarScan(config, "my-key");

    expect(result.ok).toBe(true);
    const dockerArgs = runCommand.mock.calls[0][1];
    const scannerEnv = dockerArgs.find((x) => x.startsWith("SONAR_SCANNER_OPTS="));
    expect(scannerEnv).toContain("-Dsonar.sources=src");
    expect(scannerEnv).not.toContain("public");
    expect(scannerEnv).not.toContain("lib");
    expect(scannerEnv).not.toContain("sonar.javascript.lcov.reportPaths");
  });

  it("runs configured coverage command and injects lcov path only when configured and existing", async () => {
    const config = {
      sonarqube: {
        host: "http://localhost:9000",
        token: "token-123",
        coverage: {
          enabled: true,
          command: "echo coverage",
          timeout_ms: 12345,
          block_on_failure: true,
          lcov_report_path: "package.json"
        },
        scanner: { sources: "src" }
      }
    };
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: "coverage ok", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "scan ok", stderr: "" });

    const result = await runSonarScan(config, "my-key");

    expect(result.ok).toBe(true);
    expect(runCommand.mock.calls[0][0]).toBe("bash");
    expect(runCommand.mock.calls[0][1]).toEqual(["-lc", "echo coverage"]);
    expect(runCommand.mock.calls[0][2]).toEqual({ timeout: 12345 });
    expect(runCommand.mock.calls[1][0]).toBe("docker");
    const scannerEnv = runCommand.mock.calls[1][1].find((x) => x.startsWith("SONAR_SCANNER_OPTS="));
    expect(scannerEnv).toContain("-Dsonar.javascript.lcov.reportPaths=package.json");
  });

  it("fails when coverage command fails and block_on_failure is true", async () => {
    const config = {
      sonarqube: {
        host: "http://localhost:9000",
        token: "token-123",
        coverage: {
          enabled: true,
          command: "exit 1",
          block_on_failure: true
        },
        scanner: { sources: "src" }
      }
    };
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "coverage failed" });

    const result = await runSonarScan(config, "my-key");

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("coverage failed");
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand.mock.calls[0][0]).toBe("bash");
  });

  it("continues when coverage command fails and block_on_failure is false", async () => {
    const config = {
      sonarqube: {
        host: "http://localhost:9000",
        token: "token-123",
        coverage: {
          enabled: true,
          command: "exit 1",
          block_on_failure: false
        },
        scanner: { sources: "src" }
      }
    };
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    runCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "coverage failed" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "scan ok", stderr: "" });

    const result = await runSonarScan(config, "my-key");

    expect(result.ok).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand.mock.calls[0][0]).toBe("bash");
    expect(runCommand.mock.calls[1][0]).toBe("docker");
  });

  it("supports lcov-only mode without coverage command when report exists", async () => {
    const config = {
      sonarqube: {
        host: "http://localhost:9000",
        token: "token-123",
        coverage: {
          enabled: true,
          command: null,
          lcov_report_path: "package.json",
          block_on_failure: true
        },
        scanner: { sources: "src" }
      }
    };
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "scan ok", stderr: "" });

    const result = await runSonarScan(config, "my-key");

    expect(result.ok).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand.mock.calls[0][0]).toBe("docker");
    const scannerEnv = runCommand.mock.calls[0][1].find((x) => x.startsWith("SONAR_SCANNER_OPTS="));
    expect(scannerEnv).toContain("-Dsonar.javascript.lcov.reportPaths=package.json");
  });
});
