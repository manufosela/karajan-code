import { describe, expect, it } from "vitest";
import { buildScannerOpts } from "../src/sonar/scanner.js";

describe("buildScannerOpts", () => {
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

  it("generates disabled_rules with multicriteria syntax", () => {
    const scanner = {
      disabled_rules: ["javascript:S1116", "javascript:S3776"]
    };
    const result = buildScannerOpts("proj", scanner);
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria=e1");
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria.e1.ruleKey=javascript:S1116");
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria.e1.resourceKey=**/*");
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria=e2");
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria.e2.ruleKey=javascript:S3776");
    expect(result).toContain("-Dsonar.issue.ignore.multicriteria.e2.resourceKey=**/*");
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
