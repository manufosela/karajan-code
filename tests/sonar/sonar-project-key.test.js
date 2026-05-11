import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

const { runCommand } = await import("../../src/utils/process.js");
const { resolveSonarProjectKey, canResolveSonarProjectKey } = await import("../../src/sonar/project-key.js");

describe("[opt-in: sonar] resolveSonarProjectKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KJ_SONAR_PROJECT_KEY;
  });

  it("uses explicit argument over env and config", async () => {
    process.env.KJ_SONAR_PROJECT_KEY = "env-key";
    const config = {
      sonarqube: {
        project_key: "config-key"
      }
    };

    const key = await resolveSonarProjectKey(config, { projectKey: "Arg Key" });
    expect(key).toBe("arg-key");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("uses explicit sonarqube.project_key without querying git remote", async () => {
    const config = {
      sonarqube: {
        project_key: "from-config"
      }
    };

    const key = await resolveSonarProjectKey(config);
    expect(key).toBe("from-config");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("uses KJ_SONAR_PROJECT_KEY over sonarqube.project_key", async () => {
    process.env.KJ_SONAR_PROJECT_KEY = "env-priority";
    const config = {
      sonarqube: {
        project_key: "config-key"
      }
    };

    const key = await resolveSonarProjectKey(config);
    expect(key).toBe("env-priority");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("derives key from git remote.origin.url when explicit key is not set", async () => {
    const config = { sonarqube: {} };
    runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "git@github.com:Acme/Repo.Name.git\n",
      stderr: ""
    });

    const key = await resolveSonarProjectKey(config);
    expect(key).toMatch(/^kj-repo.name-[a-f0-9]{12}$/);
    expect(runCommand).toHaveBeenCalledWith("git", ["config", "--get", "remote.origin.url"]);
  });

  it("generates the same key for SSH and HTTPS remotes of the same repo", async () => {
    const config = { sonarqube: {} };
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: "git@github.com:Acme/Repo.git\n", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "https://github.com/acme/repo.git\n", stderr: "" });

    const sshKey = await resolveSonarProjectKey(config);
    const httpsKey = await resolveSonarProjectKey(config);

    expect(sshKey).toBe(httpsKey);
  });

  it("generates different keys for different owner/repo pairs", async () => {
    const config = { sonarqube: {} };
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: "git@github.com:acme/repo.git\n", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "git@github.com:other/repo.git\n", stderr: "" });

    const keyA = await resolveSonarProjectKey(config);
    const keyB = await resolveSonarProjectKey(config);

    expect(keyA).not.toBe(keyB);
  });

  it("generates different keys for nested GitLab groups with same repo name", async () => {
    const config = { sonarqube: {} };
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: "git@gitlab.com:team-a/subgroup/repo.git\n", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "git@gitlab.com:team-b/subgroup/repo.git\n", stderr: "" });

    const keyA = await resolveSonarProjectKey(config);
    const keyB = await resolveSonarProjectKey(config);

    expect(keyA).not.toBe(keyB);
  });

  it("fails when remote.origin.url is missing and no explicit key is provided", async () => {
    const config = { sonarqube: {} };
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });

    await expect(resolveSonarProjectKey(config)).rejects.toThrow(
      "Missing git remote.origin.url. Configure remote origin or set sonarqube.project_key explicitly."
    );
  });

  it("fails with actionable error when remote.origin.url cannot be parsed", async () => {
    const config = { sonarqube: {} };
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "not-a-remote-format\n", stderr: "" });

    await expect(resolveSonarProjectKey(config)).rejects.toThrow(
      "Unable to parse git remote.origin.url. Use a valid SSH/HTTPS remote or set sonarqube.project_key explicitly."
    );
  });
});

// =====================================================================
// canResolveSonarProjectKey — non-throwing predicate used by callers
// (run-loop SonarStage, audit collector) that want to skip Sonar
// cleanly instead of letting the scanner throw "Missing git remote".
// 2026-05-07 dogfooding: N4 hit this on a fresh /tmp/... repo with no
// remote — the SonarStage threw repeatedly until max_iterations and the
// run finalised as "approved" by exhaustion fallback.
// =====================================================================
describe("[opt-in: sonar] canResolveSonarProjectKey (KJC-TSK-0373 / N4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KJ_SONAR_PROJECT_KEY;
  });

  it("returns true when an explicit projectKey option is passed", async () => {
    expect(await canResolveSonarProjectKey({ sonarqube: {} }, { projectKey: "kj-explicit" })).toBe(true);
    // git probe must NOT be invoked when an explicit key short-circuits.
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns true when KJ_SONAR_PROJECT_KEY env is set", async () => {
    process.env.KJ_SONAR_PROJECT_KEY = "env-key";
    expect(await canResolveSonarProjectKey({ sonarqube: {} })).toBe(true);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns true when sonarqube.project_key is set in config", async () => {
    expect(await canResolveSonarProjectKey({ sonarqube: { project_key: "config-key" } })).toBe(true);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns true when git remote.origin.url is present", async () => {
    runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "git@github.com:owner/repo.git\n",
      stderr: "",
    });
    expect(await canResolveSonarProjectKey({ sonarqube: {} })).toBe(true);
  });

  it("returns false when no explicit key AND no git remote", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    expect(await canResolveSonarProjectKey({ sonarqube: {} })).toBe(false);
  });

  it("returns false when git probe throws (defensive — keep run-loop alive)", async () => {
    runCommand.mockRejectedValue(new Error("git binary missing"));
    expect(await canResolveSonarProjectKey({ sonarqube: {} })).toBe(false);
  });

  it("treats whitespace-only env var as 'not set' and falls back to git probe", async () => {
    process.env.KJ_SONAR_PROJECT_KEY = "   ";
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    expect(await canResolveSonarProjectKey({ sonarqube: {} })).toBe(false);
    expect(runCommand).toHaveBeenCalled();
  });

  it("treats whitespace-only config project_key as 'not set'", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    expect(await canResolveSonarProjectKey({ sonarqube: { project_key: "  " } })).toBe(false);
    expect(runCommand).toHaveBeenCalled();
  });
});
