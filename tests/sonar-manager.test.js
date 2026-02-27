import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn()
}));

vi.mock("../src/utils/fs.js", () => ({
  ensureDir: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: { writeFile: vi.fn() }
}));

const { runCommand } = await import("../src/utils/process.js");
const { loadConfig } = await import("../src/config.js");
const { sonarUp, sonarStatus, sonarDown, ensureComposeFile } = await import("../src/sonar/manager.js");

function mockConfig(host = "http://localhost:9000", extraSonar = {}) {
  loadConfig.mockResolvedValue({
    config: {
      sonarqube: {
        host,
        ...extraSonar
      }
    }
  });
}

function mockCurlReachable() {
  runCommand.mockImplementation((cmd, args) => {
    if (cmd === "curl") return Promise.resolve({ exitCode: 0, stdout: "200", stderr: "" });
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  });
}

function mockCurlUnreachable() {
  runCommand.mockImplementation((cmd, args) => {
    if (cmd === "curl") return Promise.resolve({ exitCode: 7, stdout: "", stderr: "connection refused" });
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sonarUp", () => {
  it("skips docker when SonarQube is already reachable", async () => {
    mockConfig();
    mockCurlReachable();

    const result = await sonarUp();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("already reachable");
    const dockerCalls = runCommand.mock.calls.filter(([cmd]) => cmd === "docker");
    expect(dockerCalls).toHaveLength(0);
  });

  it("starts docker when SonarQube is not reachable", async () => {
    mockConfig();
    mockCurlUnreachable();

    await sonarUp();

    const dockerCalls = runCommand.mock.calls.filter(([cmd]) => cmd === "docker");
    expect(dockerCalls).toHaveLength(1);
    expect(dockerCalls[0][1]).toContain("up");
  });

  it("uses host from config", async () => {
    mockConfig("http://sonar.internal:9000");
    mockCurlReachable();

    const result = await sonarUp();

    const curlCall = runCommand.mock.calls.find(([cmd]) => cmd === "curl");
    expect(curlCall[1]).toContain("http://sonar.internal:9000/api/system/status");
    expect(result.stdout).toContain("sonar.internal:9000");
  });

  it("uses configured healthcheck timeout", async () => {
    mockConfig("http://localhost:9000", { timeouts: { healthcheck_seconds: 12 } });
    mockCurlReachable();

    await sonarUp();

    const curlCall = runCommand.mock.calls.find(([cmd]) => cmd === "curl");
    expect(curlCall[1]).toContain("--max-time");
    expect(curlCall[1]).toContain("12");
  });

  it("does not start docker when sonarqube.external is true", async () => {
    mockConfig("http://sonar.internal:9000", { external: true });
    mockCurlReachable();

    const result = await sonarUp();

    expect(result.exitCode).toBe(0);
    const dockerCalls = runCommand.mock.calls.filter(([cmd]) => cmd === "docker");
    expect(dockerCalls).toHaveLength(0);
  });
});

describe("sonarStatus", () => {
  it("returns container status when karajan-sonarqube is running", async () => {
    mockConfig();
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "Up 2 hours", stderr: "" });

    const result = await sonarStatus();

    expect(result.stdout).toBe("Up 2 hours");
  });

  it("detects external SonarQube when container is not running", async () => {
    mockConfig();
    let callCount = 0;
    runCommand.mockImplementation((cmd) => {
      if (cmd === "docker") return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      if (cmd === "curl") return Promise.resolve({ exitCode: 0, stdout: "200", stderr: "" });
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    });

    const result = await sonarStatus();

    expect(result.stdout).toContain("external SonarQube");
  });

  it("returns empty when nothing is running", async () => {
    mockConfig();
    runCommand.mockImplementation((cmd) => {
      if (cmd === "docker") return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      if (cmd === "curl") return Promise.resolve({ exitCode: 7, stdout: "", stderr: "connection refused" });
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    });

    const result = await sonarStatus();

    expect(result.stdout).toBe("");
  });

  it("uses configured container_name", async () => {
    mockConfig("http://localhost:9000", { container_name: "custom-sonarqube" });
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "Up 2 hours", stderr: "" });

    await sonarStatus();

    expect(runCommand.mock.calls[0][1]).toContain("name=custom-sonarqube");
  });
});

describe("sonarDown", () => {
  it("calls docker compose stop", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    await sonarDown();

    const dockerCalls = runCommand.mock.calls.filter(([cmd]) => cmd === "docker");
    expect(dockerCalls).toHaveLength(1);
    expect(dockerCalls[0][1]).toContain("stop");
  });
});

describe("ensureComposeFile", () => {
  it("returns the compose path", async () => {
    const result = await ensureComposeFile();
    expect(typeof result).toBe("string");
    expect(result).toContain("docker-compose.sonar.yml");
  });

  it("writes configured container name, network and volumes into compose file", async () => {
    const fs = await import("node:fs/promises");
    mockConfig("http://localhost:9000", {
      container_name: "sonar-custom",
      network: "sonar_custom_net",
      volumes: {
        data: "sonar_custom_data",
        logs: "sonar_custom_logs",
        extensions: "sonar_custom_extensions"
      }
    });

    await ensureComposeFile();

    const writeCall = fs.default.writeFile.mock.calls[0];
    const content = writeCall[1];
    expect(content).toContain("container_name: sonar-custom");
    expect(content).toContain("- sonar_custom_data:/opt/sonarqube/data");
    expect(content).toContain("- sonar_custom_logs:/opt/sonarqube/logs");
    expect(content).toContain("- sonar_custom_extensions:/opt/sonarqube/extensions");
    expect(content).toContain("- sonar_custom_net");
    expect(content).toContain("sonar_custom_net:");
    expect(content).toContain("name: sonar_custom_net");
  });
});
