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

const baseConfig = {
  review_mode: "standard",
  sonarqube: { enabled: true, host: "http://localhost:9000", enforcement_profile: "pragmatic" }
};

describe("doctor Squeezr check", () => {
  let runChecks;

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

    const mod = await import("../src/commands/doctor.js");
    runChecks = mod.runChecks;
  });

  it("reports Squeezr version when squeezr is found", async () => {
    const { runCommand } = await import("../src/utils/process.js");
    runCommand.mockImplementation((cmd) => {
      if (cmd.includes("squeezr")) {
        return Promise.resolve({ exitCode: 0, stdout: "squeezr 1.46.3\n", stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
    });

    const checks = await runChecks({ config: baseConfig });
    const squeezrCheck = checks.find((c) => c.name === "squeezr");

    expect(squeezrCheck).toBeDefined();
    expect(squeezrCheck.ok).toBe(true);
    expect(squeezrCheck.detail).toContain("squeezr 1.46.3");
    expect(squeezrCheck.detail).toContain("context compression active");
    expect(squeezrCheck.fix).toBeNull();
  });

  it("reports MISS with install command when squeezr is not found", async () => {
    const { runCommand } = await import("../src/utils/process.js");
    runCommand.mockImplementation((cmd) => {
      if (cmd.includes("squeezr")) {
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "not found" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
    });

    const checks = await runChecks({ config: baseConfig });
    const squeezrCheck = checks.find((c) => c.name === "squeezr");

    expect(squeezrCheck).toBeDefined();
    expect(squeezrCheck.ok).toBe(false);
    expect(squeezrCheck.detail).toContain("Not found");
    expect(squeezrCheck.detail).toContain("context compression");
    expect(squeezrCheck.fix).toContain("Install:");
  });

  it("reports MISS with install command when squeezr command throws", async () => {
    const { runCommand } = await import("../src/utils/process.js");
    runCommand.mockImplementation((cmd) => {
      if (cmd.includes("squeezr")) {
        return Promise.reject(new Error("command not found"));
      }
      return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
    });

    const checks = await runChecks({ config: baseConfig });
    const squeezrCheck = checks.find((c) => c.name === "squeezr");

    expect(squeezrCheck).toBeDefined();
    expect(squeezrCheck.ok).toBe(false);
    expect(squeezrCheck.detail).toContain("Not found");
    expect(squeezrCheck.fix).toContain("Install:");
  });
});
