import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/utils/fs.js", () => ({
  ensureDir: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    config: { sonarqube: { host: "http://localhost:9000" } }
  })
}));

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue("")
  }
}));

describe("[opt-in: sonar] sonar/manager cross-platform", () => {
  let runCommand, ensureDir;

  beforeEach(async () => {
    vi.resetAllMocks();
    const proc = await import("../src/utils/process.js");
    runCommand = proc.runCommand;

    const fsUtils = await import("../src/utils/fs.js");
    ensureDir = fsUtils.ensureDir;

    const { loadConfig } = await import("../src/config.js");
    loadConfig.mockResolvedValue({
      config: { sonarqube: { host: "http://localhost:9000" } }
    });
  });

  describe("ensureComposeFile", () => {
    it("creates KJ_HOME directory and writes compose file", async () => {
      const fs = await import("node:fs/promises");
      const { ensureComposeFile } = await import("../src/sonar/manager.js");

      await ensureComposeFile();

      expect(ensureDir).toHaveBeenCalled();
      expect(fs.default.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("docker-compose.sonar.yml"),
        expect.stringContaining("karajan-sonarqube"),
        "utf8"
      );
    });

    it("compose template uses karajan-sonarqube container name", async () => {
      const fs = await import("node:fs/promises");
      const { ensureComposeFile } = await import("../src/sonar/manager.js");

      await ensureComposeFile();

      const writeCall = fs.default.writeFile.mock.calls[0];
      const content = writeCall[1];
      expect(content).toContain("container_name: karajan-sonarqube");
      expect(content).not.toContain("container_name: sonarqube\n");
    });
  });

  describe("isSonarReachable", () => {
    it("returns true when curl gets 2xx status", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "200" });
      const { isSonarReachable } = await import("../src/sonar/manager.js");

      const result = await isSonarReachable("http://localhost:9000");
      expect(result).toBe(true);
    });

    it("returns false when curl fails", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "" });
      const { isSonarReachable } = await import("../src/sonar/manager.js");

      const result = await isSonarReachable("http://localhost:9000");
      expect(result).toBe(false);
    });

    it("returns false on non-2xx status", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "503" });
      const { isSonarReachable } = await import("../src/sonar/manager.js");

      const result = await isSonarReachable("http://localhost:9000");
      expect(result).toBe(false);
    });
  });

  describe("sonarUp", () => {
    it("skips start when SonarQube is already reachable", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "200" });
      const { sonarUp } = await import("../src/sonar/manager.js");

      const result = await sonarUp("http://localhost:9000");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("already reachable");
    });

    it("starts container when SonarQube is not reachable AND no existing sonar container is discovered", async () => {
      runCommand
        .mockResolvedValueOnce({ exitCode: 1, stdout: "" })  // isSonarReachable curl → not OK
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })  // discoverRunningSonar `docker ps` → empty
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });  // docker compose up

      const { sonarUp } = await import("../src/sonar/manager.js");
      const result = await sonarUp("http://localhost:9000");

      expect(result.exitCode).toBe(0);
      // Find the docker compose up call (last runCommand call now).
      const composeUpCall = runCommand.mock.calls.find((c) => c[1].includes("up"));
      expect(composeUpCall).toBeDefined();
      expect(composeUpCall[0]).toBe("docker");
    });

    it("reuses an already-running sonar container instead of spinning up a second one", async () => {
      runCommand
        .mockResolvedValueOnce({ exitCode: 1, stdout: "" })  // isSonarReachable curl → not OK on configured host
        .mockResolvedValueOnce({                              // discoverRunningSonar `docker ps`
          exitCode: 0,
          stdout: "abc|some-other-sonar|sonarqube:community|0.0.0.0:9015->9000/tcp",
        })
        .mockResolvedValueOnce({ exitCode: 0, stdout: "200" });  // discovery's HTTP probe → OK

      const { sonarUp } = await import("../src/sonar/manager.js");
      const result = await sonarUp("http://localhost:9000");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/Reusing existing SonarQube container/);
      expect(result.reusedHost).toBe("http://localhost:9015");
      // Crucially, no `docker compose up` was called.
      const composeUp = runCommand.mock.calls.find((c) => c[1].includes("compose") && c[1].includes("up"));
      expect(composeUp).toBeUndefined();
    });
  });

  describe("sonarStatus", () => {
    it("checks karajan-sonarqube container name", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "Up 2 hours" });
      const { sonarStatus } = await import("../src/sonar/manager.js");

      await sonarStatus();

      const psCall = runCommand.mock.calls[0];
      expect(psCall[1]).toContain("name=karajan-sonarqube");
    });
  });

  describe("sonarLogs", () => {
    it("reads logs from karajan-sonarqube container", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "log line" });
      const { sonarLogs } = await import("../src/sonar/manager.js");

      await sonarLogs();

      const logsCall = runCommand.mock.calls[0];
      expect(logsCall[1]).toContain("karajan-sonarqube");
    });
  });

  describe("checkVmMaxMapCount", () => {
    it("returns ok on macOS (darwin)", async () => {
      const { checkVmMaxMapCount } = await import("../src/sonar/manager.js");
      const result = await checkVmMaxMapCount("darwin");
      expect(result.ok).toBe(true);
      expect(result.reason).toContain("not required");
    });

    it("returns ok when vm.max_map_count is sufficient on Linux", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "vm.max_map_count = 262144" });
      const { checkVmMaxMapCount } = await import("../src/sonar/manager.js");

      const result = await checkVmMaxMapCount("linux");
      expect(result.ok).toBe(true);
    });

    it("returns not ok when vm.max_map_count is too low on Linux", async () => {
      runCommand.mockResolvedValue({ exitCode: 0, stdout: "vm.max_map_count = 65530" });
      const { checkVmMaxMapCount } = await import("../src/sonar/manager.js");

      const result = await checkVmMaxMapCount("linux");
      expect(result.ok).toBe(false);
      expect(result.fix).toContain("sysctl");
    });

    it("returns not ok when sysctl fails on Linux", async () => {
      runCommand.mockResolvedValue({ exitCode: 1, stdout: "" });
      const { checkVmMaxMapCount } = await import("../src/sonar/manager.js");

      const result = await checkVmMaxMapCount("linux");
      expect(result.ok).toBe(false);
    });
  });
});
