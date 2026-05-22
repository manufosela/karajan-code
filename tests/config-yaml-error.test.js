import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Resilience audit, Phase 3: a single bad edit in kj.config.yml used to
// brick every kj command — even `kj doctor` — because js-yaml's
// YAMLException propagates with NO file path. The error path now
// always names the file the user has to fix.

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "kj-yaml-err-proj-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

const { loadProjectConfig, loadConfig } = await import("../src/config/loader.js");

function writeBadProjectYaml(dir, body) {
  const cfgDir = join(dir, ".karajan");
  mkdirSync(cfgDir, { recursive: true });
  const p = join(cfgDir, "kj.config.yml");
  writeFileSync(p, body);
  return p;
}

describe("loader — actionable YAML error messages", () => {
  it("loadProjectConfig wraps the parse error with the offending file path", async () => {
    const badPath = writeBadProjectYaml(projectDir, "coder: claude\n  bad: [x\n");

    await expect(loadProjectConfig(projectDir)).rejects.toThrow(/Invalid YAML in/);
    await expect(loadProjectConfig(projectDir)).rejects.toThrow(badPath);
  });

  it("the thrown error carries code INVALID_YAML, the path and the original cause", async () => {
    const badPath = writeBadProjectYaml(projectDir, "broken: {");

    try {
      await loadProjectConfig(projectDir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err.code).toBe("INVALID_YAML");
      expect(err.path).toBe(badPath);
      expect(err.cause).toBeDefined();
    }
  });

  it("loadConfig propagates the same actionable error for a broken project config", async () => {
    const badPath = writeBadProjectYaml(projectDir, "trash: [unclosed\n");

    await expect(loadConfig(projectDir)).rejects.toThrow(/Invalid YAML in/);
    await expect(loadConfig(projectDir)).rejects.toThrow(badPath);
  });

  it("a valid YAML still loads without error (no regression on the happy path)", async () => {
    writeBadProjectYaml(projectDir, "coder: claude\n");

    const cfg = await loadProjectConfig(projectDir);
    expect(cfg).toEqual({ coder: "claude" });
  });
});
