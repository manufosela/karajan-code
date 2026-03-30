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

describe("doctor RTK check", () => {
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

  it("reports RTK version when rtk is found", async () => {
    const { runCommand } = await import("../src/utils/process.js");
    runCommand.mockImplementation((cmd) => {
      if (cmd.includes("rtk")) {
        return Promise.resolve({ exitCode: 0, stdout: "rtk 0.5.2\n", stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
    });

    const checks = await runChecks({ config: baseConfig });
    const rtkCheck = checks.find((c) => c.name === "rtk");

    expect(rtkCheck).toBeDefined();
    expect(rtkCheck.ok).toBe(true);
    expect(rtkCheck.detail).toContain("rtk 0.5.2");
    expect(rtkCheck.detail).toContain("token savings active");
    expect(rtkCheck.fix).toBeNull();
  });

  it("reports MISS with install command when rtk is not found", async () => {
    const { runCommand } = await import("../src/utils/process.js");
    runCommand.mockImplementation((cmd) => {
      if (cmd.includes("rtk")) {
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "not found" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
    });

    const checks = await runChecks({ config: baseConfig });
    const rtkCheck = checks.find((c) => c.name === "rtk");

    expect(rtkCheck).toBeDefined();
    expect(rtkCheck.ok).toBe(false);
    expect(rtkCheck.detail).toContain("Not found");
    expect(rtkCheck.detail).toContain("token savings");
    expect(rtkCheck.fix).toContain("Install:");
  });

  it("reports MISS with install command when rtk command throws", async () => {
    const { runCommand } = await import("../src/utils/process.js");
    runCommand.mockImplementation((cmd) => {
      if (cmd.includes("rtk")) {
        return Promise.reject(new Error("command not found"));
      }
      return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
    });

    const checks = await runChecks({ config: baseConfig });
    const rtkCheck = checks.find((c) => c.name === "rtk");

    expect(rtkCheck).toBeDefined();
    expect(rtkCheck.ok).toBe(false);
    expect(rtkCheck.detail).toContain("Not found");
    expect(rtkCheck.fix).toContain("Install:");
  });
});
