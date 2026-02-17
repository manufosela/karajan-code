import { describe, expect, it } from "vitest";
import { shouldBlockByProfile, summarizeIssues } from "../src/sonar/enforcer.js";

describe("shouldBlockByProfile", () => {
  it("pragmatic blocks only on ERROR", () => {
    expect(shouldBlockByProfile({ gateStatus: "ERROR", profile: "pragmatic" })).toBe(true);
    expect(shouldBlockByProfile({ gateStatus: "WARN", profile: "pragmatic" })).toBe(false);
    expect(shouldBlockByProfile({ gateStatus: "OK", profile: "pragmatic" })).toBe(false);
  });

  it("paranoid blocks on anything except OK", () => {
    expect(shouldBlockByProfile({ gateStatus: "ERROR", profile: "paranoid" })).toBe(true);
    expect(shouldBlockByProfile({ gateStatus: "WARN", profile: "paranoid" })).toBe(true);
    expect(shouldBlockByProfile({ gateStatus: "OK", profile: "paranoid" })).toBe(false);
  });

  it("defaults to pragmatic when no profile given", () => {
    expect(shouldBlockByProfile({ gateStatus: "WARN" })).toBe(false);
    expect(shouldBlockByProfile({ gateStatus: "ERROR" })).toBe(true);
  });
});

describe("summarizeIssues", () => {
  it("groups issues by severity", () => {
    const issues = [
      { severity: "BLOCKER" },
      { severity: "CRITICAL" },
      { severity: "BLOCKER" },
      { severity: "INFO" }
    ];
    const summary = summarizeIssues(issues);
    expect(summary).toContain("BLOCKER: 2");
    expect(summary).toContain("CRITICAL: 1");
    expect(summary).toContain("INFO: 1");
  });

  it("returns empty string for no issues", () => {
    expect(summarizeIssues([])).toBe("");
  });

  it("treats missing severity as UNKNOWN", () => {
    const issues = [{ rule: "some-rule" }];
    expect(summarizeIssues(issues)).toBe("UNKNOWN: 1");
  });
});
