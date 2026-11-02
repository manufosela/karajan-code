// KJC-TSK-1381 (#3208): on a machine without osv-scanner or semgrep the security audit
// ran two checks and still came out green. It now says how many ran, out of how many,
// and names what did not run, so a green audit is never read as a complete one.
import { describe, it, expect } from "vitest";
import { auditCoverage, formatDeterministicSummary } from "../../src/audit/deterministic-summary.js";

const ctx = {
  sonarFindings: { available: true, issues: [] },
  osvFindings: { available: false, reason: "osv-scanner not installed" },
  semgrepFindings: { available: false, reason: "semgrep not installed" },
  injectionFindings: { available: true, findings: [] },
  infraFindings: null, // skipped by a flag: not counted
};

describe("audit coverage", () => {
  it("counts the checks that ran out of those attempted and names the ones that did not", () => {
    const c = auditCoverage(ctx);
    expect(c).toMatchObject({ ran: 2, total: 4 });
    expect(c.notRun.map((n) => n.name)).toEqual(["osv-scanner", "semgrep"]);
  });

  it("the summary opens with the coverage and points at kj install-tools for missing tools", () => {
    const md = formatDeterministicSummary(ctx);
    expect(md).toMatch(/\*\*Coverage:\*\* 2 of 4 checks ran/);
    expect(md).toMatch(/osv-scanner: osv-scanner not installed/);
    expect(md).toMatch(/kj install-tools/);
  });

  it("a complete run says so, without the install hint", () => {
    const md = formatDeterministicSummary({ sonarFindings: { available: true, issues: [] } });
    expect(md).toMatch(/\*\*Coverage:\*\* 1 of 1 checks ran/);
    expect(md).not.toMatch(/kj install-tools/);
  });
});
