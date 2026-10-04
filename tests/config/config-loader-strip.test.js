import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

import { writeConfig } from "../../src/config/loader.js";

// =====================================================================
// KJC-BUG-0036 — `writeConfig` MUST strip runtime-only keys before
// serialising. Two such keys today:
//
//   1. `_deprecated`        — synthesised by the loader on every load
//                             when the user had a deprecated key set.
//                             Pure runtime metadata; persisting it
//                             "fossilises" the deprecation warning so
//                             it keeps firing even after the user
//                             cleans the offending source key.
//
//   2. `sonarqube.enabled`  — wizard-only hint (the init flow uses it
//                             to drive setupSonarQube during install,
//                             but the runtime ignored it from v2.7.4
//                             onwards). Persisting it re-triggers the
//                             deprecation warning on every kj run.
//
// Both bugs were observed during dogfooding 2026-05-07: the global
// kj.config.yml ended up with both keys baked in, making `kj run`
// noisy until cleaned up by hand.
// =====================================================================

let tmp;
let configPath;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kj-writeconfig-strip-"));
  configPath = join(tmp, "kj.config.yml");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("writeConfig — strip runtime-only keys (KJC-BUG-0036)", () => {
  it("removes the `_deprecated` block before serialising", async () => {
    await writeConfig(configPath, {
      coder: "claude",
      sonarqube: { host: "http://localhost:9000" },
      _deprecated: { sonarqubeEnabledKey: true },
    });
    const onDisk = yaml.load(readFileSync(configPath, "utf8"));
    expect(onDisk._deprecated).toBeUndefined();
    expect(onDisk.sonarqube.host).toBe("http://localhost:9000");
    expect(onDisk.coder).toBe("claude");
  });

  it("removes `sonarqube.enabled` while preserving sister sonar keys", async () => {
    await writeConfig(configPath, {
      coder: "claude",
      sonarqube: {
        enabled: true,
        host: "http://localhost:9000",
        token: "sqa_xxx",
        container_name: "kj-sonar",
      },
    });
    const onDisk = yaml.load(readFileSync(configPath, "utf8"));
    expect("enabled" in onDisk.sonarqube).toBe(false);
    expect(onDisk.sonarqube.host).toBe("http://localhost:9000");
    expect(onDisk.sonarqube.token).toBe("sqa_xxx");
    expect(onDisk.sonarqube.container_name).toBe("kj-sonar");
  });

  it("strips both keys in the same pass when both are present", async () => {
    await writeConfig(configPath, {
      sonarqube: { enabled: false, host: "http://localhost:9000" },
      _deprecated: { sonarqubeEnabledKey: true },
    });
    const onDisk = yaml.load(readFileSync(configPath, "utf8"));
    expect(onDisk._deprecated).toBeUndefined();
    expect("enabled" in onDisk.sonarqube).toBe(false);
    expect(onDisk.sonarqube.host).toBe("http://localhost:9000");
  });

  it("is a no-op when neither key is present (regression pin)", async () => {
    await writeConfig(configPath, {
      coder: "claude",
      sonarqube: { host: "http://localhost:9000" },
      pipeline: { triage: { enabled: true } }, // unrelated `enabled`s survive
    });
    const onDisk = yaml.load(readFileSync(configPath, "utf8"));
    expect(onDisk.coder).toBe("claude");
    expect(onDisk.sonarqube.host).toBe("http://localhost:9000");
    expect(onDisk.pipeline.triage.enabled).toBe(true);
  });

  it("does NOT mutate the caller's config object (purity)", async () => {
    const original = {
      sonarqube: { enabled: true, host: "http://localhost:9000" },
      _deprecated: { sonarqubeEnabledKey: true },
    };
    await writeConfig(configPath, original);
    // The caller still sees the original in-memory hint — it's only
    // the on-disk YAML that gets cleaned.
    expect(original.sonarqube.enabled).toBe(true);
    expect(original._deprecated.sonarqubeEnabledKey).toBe(true);
  });

  it("creates the parent directory when missing", async () => {
    const nestedPath = join(tmp, "deep", "nested", "kj.config.yml");
    await writeConfig(nestedPath, { coder: "claude" });
    expect(existsSync(nestedPath)).toBe(true);
  });

  it("KJC-BUG-0253: keeps the Sonar credentials out of a project config, and says which", async () => {
    const projectConfig = join(tmp, "repo", ".karajan", "kj.config.yml");
    const config = { coder: "claude", sonarqube: { host: "http://localhost:9000", token: "squ_secret", admin_password: "pw" } };
    const res = await writeConfig(projectConfig, config);
    const onDisk = yaml.load(readFileSync(projectConfig, "utf8"));
    expect(onDisk.sonarqube).toEqual({ host: "http://localhost:9000" });
    expect(readFileSync(projectConfig, "utf8")).not.toContain("squ_secret");
    expect(res.strippedSecrets).toEqual(["sonarqube.token", "sonarqube.admin_password"]);
    expect(config.sonarqube.token).toBe("squ_secret"); // the caller's object is untouched
    // Any other file (the global config included) keeps them.
    expect((await writeConfig(configPath, config)).strippedSecrets).toEqual([]);
    expect(yaml.load(readFileSync(configPath, "utf8")).sonarqube.token).toBe("squ_secret");
  });

  it("survives a config without a sonarqube block at all", async () => {
    await writeConfig(configPath, {
      coder: "claude",
      _deprecated: { sonarqubeEnabledKey: true },
    });
    const onDisk = yaml.load(readFileSync(configPath, "utf8"));
    expect(onDisk._deprecated).toBeUndefined();
    expect(onDisk.coder).toBe("claude");
    expect(onDisk.sonarqube).toBeUndefined();
  });
});
