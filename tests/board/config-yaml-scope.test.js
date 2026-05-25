import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

// v2.30.0 PR4 — Scope toggle for the writable config (global vs per-project).
// Verifies that:
//   1. readConfig() defaults to 'global' (back-compat).
//   2. readConfig({ scope: 'project' }) targets <projectDir>/.karajan/kj.config.yml.
//   3. writeConfigPatch routes writes by scope without leaking across files.
//   4. Invalid scope is rejected on both read and write.
//   5. Response shape includes the resolved `scope` so the UI can render it.

let kjHome;
let projectDir;
let envBackup;

beforeEach(() => {
  kjHome = mkdtempSync(join(tmpdir(), "kj-cfg-scope-home-"));
  projectDir = mkdtempSync(join(tmpdir(), "kj-cfg-scope-proj-"));
  envBackup = {
    KARAJAN_HOME: process.env.KARAJAN_HOME,
    KJ_PROJECT_DIR: process.env.KJ_PROJECT_DIR,
  };
  process.env.KARAJAN_HOME = kjHome;
  process.env.KJ_PROJECT_DIR = projectDir;
});

afterEach(() => {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(kjHome, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

const { readConfig, writeConfigPatch, SCOPES } = await import(
  "../../packages/hu-board/src/config-yaml.js"
);

describe("config-yaml — scope toggle (v2.30.0 PR4)", () => {
  it("exports the documented scopes", () => {
    expect(SCOPES).toEqual(expect.arrayContaining(["global", "project"]));
  });

  it("readConfig() defaults to 'global' and reports the scope", () => {
    const out = readConfig();
    expect(out.scope).toBe("global");
    expect(out.path).toBe(join(kjHome, "kj.config.yml"));
  });

  it("readConfig({ scope: 'project' }) targets <projectDir>/.karajan/kj.config.yml", () => {
    const out = readConfig({ scope: "project" });
    expect(out.scope).toBe("project");
    expect(out.path).toBe(join(projectDir, ".karajan", "kj.config.yml"));
    expect(out.exists).toBe(false);
  });

  it("writes are routed by scope without leaking across files", () => {
    const w1 = writeConfigPatch({ coder: "claude" }, { scope: "global" });
    expect(w1.written).toBe(true);
    expect(w1.scope).toBe("global");
    expect(w1.path).toBe(join(kjHome, "kj.config.yml"));

    const w2 = writeConfigPatch({ coder: "gemini" }, { scope: "project" });
    expect(w2.written).toBe(true);
    expect(w2.scope).toBe("project");
    expect(w2.path).toBe(join(projectDir, ".karajan", "kj.config.yml"));

    const globalYml = yaml.load(readFileSync(join(kjHome, "kj.config.yml"), "utf8"));
    const projectYml = yaml.load(
      readFileSync(join(projectDir, ".karajan", "kj.config.yml"), "utf8"),
    );
    expect(globalYml.coder).toBe("claude");
    expect(projectYml.coder).toBe("gemini");

    const readGlobal = readConfig({ scope: "global" });
    const readProject = readConfig({ scope: "project" });
    const fGlobal = readGlobal.fields.find((f) => f.key === "coder");
    const fProject = readProject.fields.find((f) => f.key === "coder");
    expect(fGlobal.value).toBe("claude");
    expect(fProject.value).toBe("gemini");
  });

  it("project scope creates the .karajan directory on demand", () => {
    const target = join(projectDir, ".karajan");
    expect(existsSync(target)).toBe(false);
    const r = writeConfigPatch({ sonarEnabled: true }, { scope: "project" });
    expect(r.written).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(target, "kj.config.yml"))).toBe(true);
  });

  it("rejects unknown scopes on read", () => {
    expect(() => readConfig({ scope: "nope" })).toThrow(/Scope inválido/);
  });

  it("rejects unknown scopes on write without touching disk", () => {
    const r = writeConfigPatch({ coder: "claude" }, { scope: "nope" });
    expect(r.written).toBe(false);
    expect(r.errors[0]).toMatch(/Scope inválido/);
    expect(existsSync(join(kjHome, "kj.config.yml"))).toBe(false);
    expect(existsSync(join(projectDir, ".karajan", "kj.config.yml"))).toBe(false);
  });
});
