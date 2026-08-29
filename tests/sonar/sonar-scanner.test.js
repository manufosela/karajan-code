import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildScannerOpts, respectRepoProperties, ensureSonarProjectProperties } from "../../src/sonar/scanner.js";

describe("[opt-in: sonar] buildScannerOpts", () => {
  it("generates projectKey arg", () => {
    const result = buildScannerOpts("my-project");
    expect(result).toBe("-Dsonar.projectKey=my-project");
  });

  it("generates all scanner properties", () => {
    const scanner = {
      sources: "src,lib",
      exclusions: "**/node_modules/**,**/dist/**",
      test_inclusions: "**/*.test.js",
      coverage_exclusions: "**/tests/**",
      javascript_lcov_report_paths: "coverage/lcov.info"
    };
    const result = buildScannerOpts("proj", scanner);
    expect(result).toContain("-Dsonar.projectKey=proj");
    expect(result).toContain("-Dsonar.sources=src,lib");
    expect(result).toContain("-Dsonar.exclusions=**/node_modules/**,**/dist/**");
    expect(result).toContain("-Dsonar.test.inclusions=**/*.test.js");
    expect(result).toContain("-Dsonar.coverage.exclusions=**/tests/**");
    expect(result).toContain("-Dsonar.javascript.lcov.reportPaths=coverage/lcov.info");
  });

  // KJC-BUG-0139: one `multicriteria=` property PER RULE meant last-wins —
  // with [S1116, S3776] only S3776 was really ignored. The property must be
  // declared ONCE with the full entry list; sub-properties stay per rule.
  it("declares multicriteria ONCE with the full entry list (KJC-BUG-0139)", () => {
    const scanner = {
      disabled_rules: ["javascript:S1116", "javascript:S3776"]
    };
    const result = buildScannerOpts("proj", scanner);
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria=e1,e2");
    expect(result.match(/-Dsonar\.issue\.ignore\.multicriteria=/g)).toHaveLength(1);
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria.e1.ruleKey=javascript:S1116");
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria.e1.resourceKey=**/*");
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria.e2.ruleKey=javascript:S3776");
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria.e2.resourceKey=**/*");
  });

  it("a single disabled rule still declares the list form", () => {
    const result = buildScannerOpts("proj", { disabled_rules: ["javascript:S1116"] });
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria=e1");
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria.e1.ruleKey=javascript:S1116");
  });

  it("works without scanner config (backward compatible)", () => {
    const result = buildScannerOpts("proj");
    expect(result).toBe("-Dsonar.projectKey=proj");
  });

  it("works with empty scanner object", () => {
    const result = buildScannerOpts("proj", {});
    expect(result).toBe("-Dsonar.projectKey=proj");
  });

  it("skips undefined optional fields", () => {
    const scanner = { sources: "src" };
    const result = buildScannerOpts("proj", scanner);
    expect(result).toContain("-Dsonar.sources=src");
    expect(result).not.toContain("exclusions");
    expect(result).not.toContain("test.inclusions");
    expect(result).not.toContain("coverage.exclusions");
    expect(result).not.toContain("multicriteria");
  });
});

// KJC-BUG-0156 (issue #1543) — a monorepo with a correct sonar-project.properties
// was overridden by kj's own -Dsonar.sources on EVERY scan: the file was useless,
// the gate silently skipped for 8 PRs, and a real bug sat behind "APPROVED".
// When the repo brings the canonical file, kj's layout opts must stand down.
describe("[opt-in: sonar] respectRepoProperties (KJC-BUG-0156)", () => {
  it("strips kj's layout opts when the repo brings its own properties — the ignore rules stay (they are kj's, not layout)", () => {
    const scanner = { sources: "src,public,lib", exclusions: "x", test_inclusions: "y", coverage_exclusions: "z", javascript_lcov_report_paths: "l", disabled_rules: ["js:S1"] };
    const kept = respectRepoProperties(scanner, { existed: true });
    expect(kept.sources).toBeUndefined();
    expect(kept.exclusions).toBeUndefined();
    expect(kept.test_inclusions).toBeUndefined();
    expect(kept.coverage_exclusions).toBeUndefined();
    expect(kept.javascript_lcov_report_paths).toBeUndefined();
    expect(kept.disabled_rules).toEqual(["js:S1"]);
  });
  it("leaves everything untouched when kj generated the properties itself", () => {
    const scanner = { sources: "src", disabled_rules: [] };
    expect(respectRepoProperties(scanner, { existed: false })).toEqual(scanner);
  });
});

describe("[opt-in: sonar] ensureSonarProjectProperties (KJC-BUG-0156)", () => {
  it("reports existed=true and the repo's declared projectKey — that key is what the server will know", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kj-sonar-props-"));
    try {
      writeFileSync(join(dir, "sonar-project.properties"), "sonar.projectKey=my-monorepo\nsonar.sources=apps,packages,tools\n");
      const r = await ensureSonarProjectProperties(dir);
      expect(r).toMatchObject({ existed: true, declaredKey: "my-monorepo" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("generates the file and reports existed=false when the repo has none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kj-sonar-props-"));
    try {
      const r = await ensureSonarProjectProperties(dir);
      expect(r.existed).toBe(false);
      expect(readFileSync(join(dir, "sonar-project.properties"), "utf8")).toContain("sonar.sources=src");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
