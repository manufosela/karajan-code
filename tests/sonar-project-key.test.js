import { describe, expect, it } from "vitest";
import { resolveSonarProjectKey } from "../src/sonar/project-key.js";

describe("resolveSonarProjectKey", () => {
  it("uses explicit sonarqube.project_key when configured", async () => {
    const config = {
      sonarqube: {
        project_key: "my-custom-key"
      }
    };

    const key = await resolveSonarProjectKey(config, { cwd: "/tmp/repo-a" });
    expect(key).toBe("my-custom-key");
  });

  it("derives different keys for different workdirs by default", async () => {
    const config = { sonarqube: {} };

    const keyA = await resolveSonarProjectKey(config, { cwd: "/tmp/work/repo-a" });
    const keyB = await resolveSonarProjectKey(config, { cwd: "/tmp/work/repo-b" });

    expect(keyA).not.toBe(keyB);
    expect(keyA).toMatch(/^kj-/);
    expect(keyB).toMatch(/^kj-/);
  });
});
