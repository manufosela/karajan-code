import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

const { runCommand } = await import("../src/utils/process.js");
const { resolveSonarProjectKey } = await import("../src/sonar/project-key.js");

describe("resolveSonarProjectKey", () => {
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
