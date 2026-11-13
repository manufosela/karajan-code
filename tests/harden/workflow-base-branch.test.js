import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installWorkflows } from "../../src/harden/workflow-engine.js";

let dir;
const wfDir = () => join(dir, ".github", "workflows");
const branchesOf = (file) => yaml.load(readFileSync(join(wfDir(), file), "utf8")).on.pull_request.branches;
// Strict + publishable seeds every workflow that listens to pull_request.
const seed = (baseBranch) => {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", bin: "x.js", scripts: { lint: "eslint ." } }));
  return installWorkflows({ projectDir: dir, language: "javascript", profile: "strict", baseBranch });
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-wf-base-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("workflows trigger on the repo's base branch (HU-3531)", () => {
  it("writes the base branch into every pull_request workflow", () => {
    seed("develop");
    // Policy, verdicts and the secret scan judge every PR, whatever its base (HU-4012, HU-4144).
    const files = readdirSync(wfDir()).filter((f) => !["kj-policy.yml", "kj-verdicts.yml", "kj-secrets.yml"].includes(f));
    expect(files).toEqual(expect.arrayContaining(["kj-no-ai-attribution.yml", "kj-quality.yml", "kj-shrink-budget.yml", "kj-pack-smoke.yml"]));
    for (const f of files) expect(branchesOf(f), f).toEqual(["develop"]);
  });

  it("keeps the exact same text for main as the default", () => {
    seed("main");
    const withMain = readFileSync(join(wfDir(), "kj-quality.yml"), "utf8");
    expect(withMain).toContain("    branches: [main]\n");
    rmSync(wfDir(), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", bin: "x.js", scripts: { lint: "eslint ." } }));
    installWorkflows({ projectDir: dir, language: "javascript", profile: "strict" });
    expect(readFileSync(join(wfDir(), "kj-quality.yml"), "utf8")).toBe(withMain);
  });

  it.each(["develop", "release/1.x", "feature#2", "it's", "123", "true", "null", "1.5", "~", "yes", "no", "on"])(
    "quotes %s so YAML reads it back as the exact string",
    (name) => {
      seed(name);
      const [branch, ...rest] = branchesOf("kj-quality.yml");
      expect(rest).toEqual([]);
      expect(typeof branch).toBe("string");
      expect(branch).toBe(name);
    },
  );

  it("single-quotes every name except main, doubling embedded apostrophes", () => {
    seed("develop");
    expect(readFileSync(join(wfDir(), "kj-quality.yml"), "utf8")).toContain("    branches: ['develop']\n");
    rmSync(wfDir(), { recursive: true });
    seed("it's");
    expect(readFileSync(join(wfDir(), "kj-quality.yml"), "utf8")).toContain("    branches: ['it''s']\n");
  });

  it.each(["dev\nmain", "a: b", "", "x\r\ny"])("rejects the hostile name %j", (name) => {
    expect(() => seed(name)).toThrow(/base branch/i);
  });
});
