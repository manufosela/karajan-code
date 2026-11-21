// HU-4746: one filter for what Sonar counts as code, fed by the BASE branch's layout.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedGitEnv } from "../_helpers/isolated-git.js";
import { sonarSourcesOf, checkSonarRequirement } from "../../src/review/sonar-requirement.js";
import { readBaseSonarLayout } from "../../src/review/sonar-layout.js";
import { pregateResult } from "../../src/review/sonar-pregate.js";
import { touchesCode } from "../../src/review/verify-pr.js";

const layout = { tests: ["e2e"], testInclusions: ["e2e/**"], testExclusions: [], exclusions: ["gen/**"] };
const none = { tests: [], testInclusions: [], testExclusions: [], exclusions: [] };

describe("sonarSourcesOf", () => {
  const files = ["src/a.ts", "e2e/fixtures.ts", "gen/x.ts", "README.md"];
  it("drops test and excluded files, keeps normal sources", () => {
    expect(sonarSourcesOf({ config: {}, files, layout })).toEqual(["src/a.ts"]);
  });
  it("keeps every source with the empty layout or none", () => {
    expect(sonarSourcesOf({ config: {}, files, layout: none })).toEqual(["src/a.ts", "e2e/fixtures.ts", "gen/x.ts"]);
    expect(sonarSourcesOf({ config: {}, files })).toEqual(["src/a.ts", "e2e/fixtures.ts", "gen/x.ts"]);
  });
});

describe("the other gates use it", () => {
  it("pregateResult only demands coverage of what Sonar counts", () => {
    const r = pregateResult({ config: {}, stagedFiles: ["src/a.ts", "e2e/f.ts"], touchedLines: null, indexed: new Set(["src/a.ts"]), issues: [], keys: ["k"], totalProject: 0, layout });
    expect(r.uncovered).toEqual([]);
    expect(r.covered).toEqual(["src/a.ts"]);
  });
  it("touchesCode ignores a commit that only touches test files of the layout", async () => {
    const run = async () => ({ exitCode: 0, stdout: "e2e/f.ts\n", stderr: "" });
    expect(await touchesCode("/p", "abc", run, {}, layout)).toBe(false);
    expect(await touchesCode("/p", "abc", run, {}, none)).toBe(true);
  });
});

describe("the layout comes from the base commit only", () => {
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: isolatedGitEnv(), encoding: "utf8" });
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "kj-sonar-base-"));
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "t");
    writeFileSync(join(dir, "sonar-project.properties"), "sonar.tests=e2e\nsonar.test.inclusions=e2e/**\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "base");
    return dir;
  };
  const demanded = async (dir, staged) => {
    const base = await readBaseSonarLayout({ cwd: dir, base: "main" });
    return checkSonarRequirement({ config: {}, stagedFiles: staged, sonar: null, layout: base }).mode;
  };
  it("a staged e2e fixture needs no coverage", async () => {
    const dir = repo();
    mkdirSync(join(dir, "e2e"));
    writeFileSync(join(dir, "e2e/fixtures.ts"), "export {};\n");
    git(dir, "add", ".");
    expect(await demanded(dir, ["e2e/fixtures.ts"])).toBe("docs-only");
  });
  it("a changed properties file in the same diff does not hide a source", async () => {
    const dir = repo();
    writeFileSync(join(dir, "sonar-project.properties"), "sonar.tests=src\n");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/a.ts"), "export {};\n");
    git(dir, "add", ".");
    expect(await demanded(dir, ["src/a.ts", "sonar-project.properties"])).toBe("block");
  });
});
