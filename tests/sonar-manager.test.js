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

function mockConfig(host = "http://localhost:9000") {
  loadConfig.mockResolvedValue({ config: { sonarqube: { host } } });
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
});

describe("sonarStatus", () => {
  it("returns container status when karajan-sonarqube is running", async () => {
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
});
