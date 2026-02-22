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

  it("fails when remote.origin.url is missing and no explicit key is provided", async () => {
    const config = { sonarqube: {} };
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });

    await expect(resolveSonarProjectKey(config)).rejects.toThrow(
      "Missing git remote.origin.url. Configure remote origin or set sonarqube.project_key explicitly."
    );
  });
});
