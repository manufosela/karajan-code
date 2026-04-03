import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/bin/${name}`)
}));

vi.mock("../src/utils/fs.js", () => ({
  exists: vi.fn(),
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
  isSonarReachable: vi.fn()
}));

vi.mock("../src/roles/base-role.js", () => ({
  resolveRoleMdPath: vi.fn().mockReturnValue(["/fake/reviewer.md"]),
  loadFirstExisting: vi.fn()
}));

vi.mock("../src/utils/git.js", () => ({
  ensureGitRepo: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
    access: vi.fn().mockResolvedValue(undefined)
  }
}));

const baseConfig = {
  review_mode: "standard",
  sonarqube: { enabled: true, host: "http://localhost:9000", enforcement_profile: "pragmatic" }
};

describe("doctor", () => {
  let runChecks, doctorCommand;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});

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

    // Agent config files: simulate ENOENT (not found) so checks are skipped
    const fsPromises = await import("node:fs/promises");
    fsPromises.default.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    const mod = await import("../src/commands/doctor.js");
    runChecks = mod.runChecks;
    doctorCommand = mod.doctorCommand;
  });

  describe("runChecks", () => {
    it("returns an array of check results", async () => {
      const checks = await runChecks({ config: baseConfig });
      expect(Array.isArray(checks)).toBe(true);
      expect(checks.length).toBeGreaterThan(5);
    });

    it("includes config, git, docker, sonarqube, agents, and rules checks", async () => {
      const checks = await runChecks({ config: baseConfig });
      const names = checks.map((c) => c.name);

      expect(names).toContain("config");
      expect(names).toContain("git");
      expect(names).toContain("docker");
      expect(names).toContain("sonarqube");
      expect(names).toContain("agent:claude");
      expect(names).toContain("agent:codex");
      expect(names).toContain("agent:gemini");
      expect(names).toContain("agent:aider");
      expect(names).toContain("review-rules");
      expect(names).toContain("coder-rules");
    });

    it("marks config as OK when file exists", async () => {
      const checks = await runChecks({ config: baseConfig });
      const configCheck = checks.find((c) => c.name === "config");
      expect(configCheck.ok).toBe(true);
    });

    it("marks config as MISS when file does not exist", async () => {
      const { exists } = await import("../src/utils/fs.js");
      exists.mockResolvedValue(false);

      const checks = await runChecks({ config: baseConfig });
      const configCheck = checks.find((c) => c.name === "config");
      expect(configCheck.ok).toBe(false);
      expect(configCheck.fix).toContain("kj init");
    });

    it("marks git as MISS when not in a repo", async () => {
      const { ensureGitRepo } = await import("../src/utils/git.js");
      ensureGitRepo.mockResolvedValue(false);

      const checks = await runChecks({ config: baseConfig });
      const gitCheck = checks.find((c) => c.name === "git");
      expect(gitCheck.ok).toBe(false);
      expect(gitCheck.fix).toContain("git init");
    });

    it("marks sonar as OK when disabled in config", async () => {
      const { isSonarReachable } = await import("../src/sonar/manager.js");
      isSonarReachable.mockResolvedValue(false);

      const config = { ...baseConfig, sonarqube: { ...baseConfig.sonarqube, enabled: false } };
      const checks = await runChecks({ config });
      const sonarCheck = checks.find((c) => c.name === "sonarqube");
      expect(sonarCheck.ok).toBe(true);
      expect(sonarCheck.detail).toContain("Disabled");
    });

    it("marks sonar as MISS when not reachable", async () => {
      const { isSonarReachable } = await import("../src/sonar/manager.js");
      isSonarReachable.mockResolvedValue(false);

      const checks = await runChecks({ config: baseConfig });
      const sonarCheck = checks.find((c) => c.name === "sonarqube");
      expect(sonarCheck.ok).toBe(false);
      expect(sonarCheck.fix).toContain("kj sonar start");
    });

    it("marks agent as MISS when binary not found", async () => {
      const { runCommand } = await import("../src/utils/process.js");
      // Make only claude fail
      runCommand.mockImplementation((cmd) => {
        if (cmd.includes("claude")) {
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "not found" });
        }
        return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
      });

      const checks = await runChecks({ config: baseConfig });
      const claudeCheck = checks.find((c) => c.name === "agent:claude");
      expect(claudeCheck.ok).toBe(false);
      expect(claudeCheck.fix).toContain("npm install");
    });

    it("each check has name, label, ok, detail fields", async () => {
      const checks = await runChecks({ config: baseConfig });
      for (const check of checks) {
        expect(check).toHaveProperty("name");
        expect(check).toHaveProperty("label");
        expect(typeof check.ok).toBe("boolean");
        expect(check).toHaveProperty("detail");
      }
    });
  });

  describe("doctorCommand", () => {
    it("returns check results", async () => {
      const checks = await doctorCommand({ config: baseConfig });
      expect(Array.isArray(checks)).toBe(true);
    });

    it("prints fix suggestions for failed checks", async () => {
      const { exists } = await import("../src/utils/fs.js");
      exists.mockResolvedValue(false);

      await doctorCommand({ config: baseConfig });

      const output = console.log.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("->");
      expect(output).toContain("kj init");
    });

    it("prints 'All checks passed' when everything is OK", async () => {
      await doctorCommand({ config: baseConfig });

      const output = console.log.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("All checks passed");
    });

    it("prints issue count when there are failures", async () => {
      const { exists } = await import("../src/utils/fs.js");
      exists.mockResolvedValue(false);
      const { isSonarReachable } = await import("../src/sonar/manager.js");
      isSonarReachable.mockResolvedValue(false);

      await doctorCommand({ config: baseConfig });

      const output = console.log.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toMatch(/\d+ issue/);
    });
  });
});
