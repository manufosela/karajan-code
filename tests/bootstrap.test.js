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
  resolveRole: vi.fn().mockReturnValue({ provider: "claude", model: null })
}));

vi.mock("../src/sonar/manager.js", () => ({
  isSonarReachable: vi.fn(),
  sonarUp: vi.fn()
}));

vi.mock("../src/utils/git.js", () => ({
  ensureGitRepo: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn()
  }
}));

const baseConfig = {
  review_mode: "standard",
  coder: "claude",
  roles: { coder: { provider: "claude", model: null } },
  sonarqube: { enabled: true, host: "http://localhost:9000" }
};

const PROJECT_DIR = "/home/user/my-project";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const PKG_VERSION = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")).version;

function makeValidBootstrap(overrides = {}) {
  return {
    version: 1,
    karajanVersion: PKG_VERSION,
    createdAt: new Date().toISOString(),
    projectDir: PROJECT_DIR,
    checks: {
      gitRepo: { ok: true },
      gitRemote: { ok: true },
      config: { ok: true },
      coreBinaries: { ok: true },
      agents: { ok: true },
      sonarqube: { ok: true }
    },
    ...overrides
  };
}

describe("bootstrap", () => {
  let ensureBootstrap, invalidateBootstrap;

  beforeEach(async () => {
    vi.resetAllMocks();

    const { runCommand } = await import("../src/utils/process.js");
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "git@github.com:user/repo.git\n", stderr: "" });

    const { exists } = await import("../src/utils/fs.js");
    exists.mockResolvedValue(true);

    const { ensureGitRepo } = await import("../src/utils/git.js");
    ensureGitRepo.mockResolvedValue(true);

    const { isSonarReachable } = await import("../src/sonar/manager.js");
    isSonarReachable.mockResolvedValue(true);

    const { resolveRole } = await import("../src/config.js");
    resolveRole.mockReturnValue({ provider: "claude", model: null });

    const fsPromises = await import("node:fs/promises");
    // Default: no bootstrap file exists
    fsPromises.default.readFile.mockRejectedValue(new Error("ENOENT"));
    fsPromises.default.writeFile.mockResolvedValue(undefined);
    fsPromises.default.unlink.mockResolvedValue(undefined);

    const mod = await import("../src/bootstrap.js");
    ensureBootstrap = mod.ensureBootstrap;
    invalidateBootstrap = mod.invalidateBootstrap;
  });

  describe("ensureBootstrap", () => {
    it("passes when all checks succeed and no bootstrap file exists", async () => {
      await expect(ensureBootstrap(PROJECT_DIR, baseConfig)).resolves.toBeUndefined();

      const fsPromises = await import("node:fs/promises");
      expect(fsPromises.default.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(".kj-ready.json"),
        expect.any(String),
        "utf8"
      );
    });

    it("skips checks when valid bootstrap file exists", async () => {
      const fsPromises = await import("node:fs/promises");
      fsPromises.default.readFile.mockResolvedValue(JSON.stringify(makeValidBootstrap()));

      const { ensureGitRepo } = await import("../src/utils/git.js");

      await ensureBootstrap(PROJECT_DIR, baseConfig);

      // Checks should NOT have been called because cached file is valid
      expect(ensureGitRepo).not.toHaveBeenCalled();
      // Should NOT write a new file
      expect(fsPromises.default.writeFile).not.toHaveBeenCalled();
    });

    it("re-runs checks when bootstrap file has different KJ version", async () => {
      const fsPromises = await import("node:fs/promises");
      fsPromises.default.readFile.mockResolvedValue(
        JSON.stringify(makeValidBootstrap({ karajanVersion: "0.0.1" }))
      );

      const { ensureGitRepo } = await import("../src/utils/git.js");

      await ensureBootstrap(PROJECT_DIR, baseConfig);

      expect(ensureGitRepo).toHaveBeenCalled();
      expect(fsPromises.default.writeFile).toHaveBeenCalled();
    });

    it("re-runs checks when bootstrap file expired (TTL)", async () => {
      const expired = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
      const fsPromises = await import("node:fs/promises");
      fsPromises.default.readFile.mockResolvedValue(
        JSON.stringify(makeValidBootstrap({ createdAt: expired }))
      );

      const { ensureGitRepo } = await import("../src/utils/git.js");

      await ensureBootstrap(PROJECT_DIR, baseConfig);

      expect(ensureGitRepo).toHaveBeenCalled();
    });

    it("re-runs checks when projectDir mismatch", async () => {
      const fsPromises = await import("node:fs/promises");
      fsPromises.default.readFile.mockResolvedValue(
        JSON.stringify(makeValidBootstrap({ projectDir: "/other/project" }))
      );

      const { ensureGitRepo } = await import("../src/utils/git.js");

      await ensureBootstrap(PROJECT_DIR, baseConfig);

      expect(ensureGitRepo).toHaveBeenCalled();
    });

    it("auto-inits git repo when not a git repository", async () => {
      const { ensureGitRepo } = await import("../src/utils/git.js");
      ensureGitRepo.mockResolvedValue(false);

      const { runCommand } = await import("../src/utils/process.js");
      runCommand.mockImplementation((cmd, args) => {
        if (cmd === "git" && args?.[0] === "init") {
          return Promise.resolve({ exitCode: 0, stdout: "Initialized empty Git repository", stderr: "" });
        }
        return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
      });

      await expect(ensureBootstrap(PROJECT_DIR, baseConfig)).resolves.toBeUndefined();
    });

    it("hard fails when git init also fails", async () => {
      const { ensureGitRepo } = await import("../src/utils/git.js");
      ensureGitRepo.mockResolvedValue(false);

      const { runCommand } = await import("../src/utils/process.js");
      runCommand.mockImplementation((cmd, args) => {
        if (cmd === "git" && args?.[0] === "init") {
          return Promise.resolve({ exitCode: 128, stdout: "", stderr: "permission denied" });
        }
        return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
      });

      await expect(ensureBootstrap(PROJECT_DIR, baseConfig)).rejects.toThrow("BOOTSTRAP FAILED");
    });

    it("passes when no git remote (new project)", async () => {
      const { runCommand } = await import("../src/utils/process.js");
      runCommand.mockImplementation((cmd, args) => {
        if (args?.includes("get-url")) {
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "No such remote" });
        }
        return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
      });

      await expect(ensureBootstrap(PROJECT_DIR, baseConfig)).resolves.toBeUndefined();
    });

    it("hard fails when config file missing", async () => {
      const { exists } = await import("../src/utils/fs.js");
      exists.mockResolvedValue(false);

      await expect(ensureBootstrap(PROJECT_DIR, baseConfig)).rejects.toThrow("BOOTSTRAP FAILED");
      await expect(ensureBootstrap(PROJECT_DIR, baseConfig)).rejects.toThrow("kj_init");
    });

    it("hard fails when core binary missing", async () => {
      const { runCommand } = await import("../src/utils/process.js");
      runCommand.mockImplementation((cmd) => {
        if (cmd.includes("git")) {
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "not found" });
        }
        if (cmd.includes("node") || cmd.includes("npm")) {
          return Promise.resolve({ exitCode: 0, stdout: "v20.0.0\n", stderr: "" });
        }
        // git remote get-url origin — needs special handling
        return Promise.resolve({ exitCode: 0, stdout: "git@github.com:user/repo.git\n", stderr: "" });
      });

      await expect(ensureBootstrap(PROJECT_DIR, baseConfig)).rejects.toThrow("BOOTSTRAP FAILED");
    });

    it("hard fails when coder agent CLI not found", async () => {
      const { runCommand } = await import("../src/utils/process.js");
      runCommand.mockImplementation((cmd, args) => {
        if (cmd.includes("claude")) {
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "not found" });
        }
        return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
      });

      await expect(ensureBootstrap(PROJECT_DIR, baseConfig)).rejects.toThrow("BOOTSTRAP FAILED");
      await expect(ensureBootstrap(PROJECT_DIR, baseConfig)).rejects.toThrow("kj_doctor");
    });

    it("hard fails when SonarQube enabled but not reachable", async () => {
      const { isSonarReachable, sonarUp } = await import("../src/sonar/manager.js");
      isSonarReachable.mockResolvedValue(false);
      sonarUp.mockRejectedValue(new Error("docker not found"));

      await expect(ensureBootstrap(PROJECT_DIR, baseConfig)).rejects.toThrow("BOOTSTRAP FAILED");
      await expect(ensureBootstrap(PROJECT_DIR, baseConfig)).rejects.toThrow("SonarQube");
    });

    it("passes when SonarQube disabled in config", async () => {
      const { isSonarReachable } = await import("../src/sonar/manager.js");
      isSonarReachable.mockResolvedValue(false);

      const config = { ...baseConfig, sonarqube: { ...baseConfig.sonarqube, enabled: false } };

      await expect(ensureBootstrap(PROJECT_DIR, config)).resolves.toBeUndefined();
    });

    it("attempts sonarUp before failing SonarQube check", async () => {
      const { isSonarReachable, sonarUp } = await import("../src/sonar/manager.js");
      isSonarReachable
        .mockResolvedValueOnce(false)   // first check: not reachable
        .mockResolvedValueOnce(true);   // after sonarUp: reachable
      sonarUp.mockResolvedValue(undefined);

      await expect(ensureBootstrap(PROJECT_DIR, baseConfig)).resolves.toBeUndefined();
      expect(sonarUp).toHaveBeenCalled();
    });

    it("treats missing version field as invalid bootstrap file", async () => {
      const fsPromises = await import("node:fs/promises");
      fsPromises.default.readFile.mockResolvedValue(
        JSON.stringify({ karajanVersion: "1.34.4", createdAt: new Date().toISOString(), projectDir: PROJECT_DIR })
      );

      const { ensureGitRepo } = await import("../src/utils/git.js");

      await ensureBootstrap(PROJECT_DIR, baseConfig);

      expect(ensureGitRepo).toHaveBeenCalled();
    });

    it("treats schema version mismatch as invalid bootstrap file", async () => {
      const fsPromises = await import("node:fs/promises");
      fsPromises.default.readFile.mockResolvedValue(
        JSON.stringify(makeValidBootstrap({ version: 999 }))
      );

      const { ensureGitRepo } = await import("../src/utils/git.js");

      await ensureBootstrap(PROJECT_DIR, baseConfig);

      expect(ensureGitRepo).toHaveBeenCalled();
    });

    it("includes all failure messages and fix suggestions", async () => {
      const { ensureGitRepo } = await import("../src/utils/git.js");
      ensureGitRepo.mockResolvedValue(false);

      const { runCommand } = await import("../src/utils/process.js");
      runCommand.mockImplementation((cmd, args) => {
        // git init also fails
        if (cmd === "git" && args?.[0] === "init") {
          return Promise.resolve({ exitCode: 128, stdout: "", stderr: "permission denied" });
        }
        // config file check: exists returns false (mocked below)
        return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
      });

      const { exists } = await import("../src/utils/fs.js");
      exists.mockResolvedValue(false);

      try {
        await ensureBootstrap(PROJECT_DIR, baseConfig);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err.message).toContain("BOOTSTRAP FAILED");
        expect(err.message).toContain("gitRepo");
        expect(err.message).toContain("Fix:");
        expect(err.message).toContain("kj_doctor");
      }
    });

    it("does not write bootstrap file when checks fail", async () => {
      const { ensureGitRepo } = await import("../src/utils/git.js");
      ensureGitRepo.mockResolvedValue(false);

      const { runCommand } = await import("../src/utils/process.js");
      runCommand.mockImplementation((cmd, args) => {
        if (cmd === "git" && args?.[0] === "init") {
          return Promise.resolve({ exitCode: 128, stdout: "", stderr: "permission denied" });
        }
        return Promise.resolve({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });
      });

      const fsPromises = await import("node:fs/promises");

      try {
        await ensureBootstrap(PROJECT_DIR, baseConfig);
      } catch { /* expected */ }

      expect(fsPromises.default.writeFile).not.toHaveBeenCalled();
    });
  });

  describe("invalidateBootstrap", () => {
    it("deletes .kj-ready.json when it exists", async () => {
      const fsPromises = await import("node:fs/promises");
      fsPromises.default.unlink.mockResolvedValue(undefined);

      await invalidateBootstrap(PROJECT_DIR);

      expect(fsPromises.default.unlink).toHaveBeenCalledWith(
        expect.stringContaining(".kj-ready.json")
      );
    });

    it("does not throw when file does not exist", async () => {
      const fsPromises = await import("node:fs/promises");
      fsPromises.default.unlink.mockRejectedValue(new Error("ENOENT"));

      await expect(invalidateBootstrap(PROJECT_DIR)).resolves.toBeUndefined();
    });
  });
});
