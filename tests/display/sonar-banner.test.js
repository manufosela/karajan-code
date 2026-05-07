import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { printSessionSonar } from "../../src/utils/display/session-summary.js";
import { ANSI } from "../../src/utils/display/formatters.js";

// Regression for N4 dogfooding (2026-05-07): the `🏁 Result` banner's
// Sonar line rendered every non-OK gate status in red, which made
// a legitimate SKIPPED (no git remote / no project_key — opt-out, not
// a failure) look like a fail during the live demo.

describe("display/session-summary — printSessionSonar gate colour", () => {
  let output;
  beforeEach(() => {
    output = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { output.push(args.join(" ")); });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function lastLine() {
    return output.at(-1) || "";
  }

  it("noop when sonar is null/undefined", () => {
    printSessionSonar(null);
    expect(output).toHaveLength(0);
  });

  it("renders OK in green", () => {
    printSessionSonar({ gateStatus: "OK", openIssues: 0 });
    expect(lastLine()).toContain(ANSI.green);
    expect(lastLine()).not.toContain(ANSI.red);
    expect(lastLine()).toContain("Sonar:");
    expect(lastLine()).toContain("OK");
  });

  it("renders SKIPPED in gray (NOT red)", () => {
    printSessionSonar({ gateStatus: "SKIPPED", openIssues: 0 });
    expect(lastLine()).toContain(ANSI.gray);
    expect(lastLine()).not.toContain(ANSI.red);
    expect(lastLine()).not.toContain(ANSI.green);
    expect(lastLine()).toContain("SKIPPED");
  });

  it("renders PENDING in gray", () => {
    printSessionSonar({ gateStatus: "PENDING", openIssues: 0 });
    expect(lastLine()).toContain(ANSI.gray);
    expect(lastLine()).not.toContain(ANSI.red);
    expect(lastLine()).toContain("PENDING");
  });

  it("renders ERROR in red", () => {
    printSessionSonar({ gateStatus: "ERROR", openIssues: 12 });
    expect(lastLine()).toContain(ANSI.red);
    expect(lastLine()).not.toContain(ANSI.green);
    expect(lastLine()).toContain("ERROR");
    expect(lastLine()).toContain("12 issues");
  });

  it("renders WARN (or any other unexpected status) in red — fail-safe", () => {
    printSessionSonar({ gateStatus: "WARN", openIssues: 3 });
    expect(lastLine()).toContain(ANSI.red);
    expect(lastLine()).toContain("WARN");
  });

  it("includes openIssues count in the banner", () => {
    printSessionSonar({ gateStatus: "OK", openIssues: 7 });
    expect(lastLine()).toContain("7 issues");
  });

  it("falls back to '0 issues' when openIssues is missing", () => {
    printSessionSonar({ gateStatus: "SKIPPED" });
    expect(lastLine()).toContain("0 issues");
  });
});
