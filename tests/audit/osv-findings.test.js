import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// KJC-TSK-0668: the collector runs through the tool governor now — mock it
// so tests drive the same {stdout}/rejection contract without real spawns.
const execFileMock = vi.fn();

vi.mock("../../src/utils/tool-governor.js", () => ({
  runGoverned: (...args) => Promise.resolve(execFileMock(...args)),
}));

import { collectOsvFindings, parseOsvOutput, groupVulnerabilitiesBySeverity } from "../../src/audit/osv-findings.js";
import { buildAuditPrompt } from "../../src/prompts/audit.js";

const noopLogger = { warn: vi.fn(), info: vi.fn() };

describe("collectOsvFindings (KJC-TSK-0365)", () => {
  beforeEach(() => { vi.resetAllMocks(); process.env.KJ_ALLOW_REAL_SCANS = "1"; });
  afterEach(() => { delete process.env.KJ_ALLOW_REAL_SCANS; });

  // KJC-BUG-0122: the kill-switch — under the test runner, without the
  // explicit opt-in, the collector never spawns anything.
  it("refuses to scan under VITEST without KJ_ALLOW_REAL_SCANS", async () => {
    delete process.env.KJ_ALLOW_REAL_SCANS;
    const r = await collectOsvFindings(".", noopLogger);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/disabled under the test runner/);
    expect(execFileMock).not.toHaveBeenCalled();
  });


  it("returns available=false when osv-scanner is not installed (ENOENT)", async () => {
    const enoErr = Object.assign(new Error("not found"), { code: "ENOENT" });
    execFileMock.mockRejectedValue(enoErr);

    const r = await collectOsvFindings("/tmp", noopLogger);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/not installed/);
    expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringContaining("osv-scanner not found"));
  });

  it("returns available=false when scanner times out", async () => {
    const timeoutErr = Object.assign(new Error("killed"), { killed: true });
    execFileMock.mockRejectedValue(timeoutErr);

    const r = await collectOsvFindings("/tmp", noopLogger);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/timed out/);
  });

  it("returns available=false when scanner output is unparseable", async () => {
    execFileMock.mockResolvedValue({ stdout: "not JSON {{{", stderr: "" });

    const r = await collectOsvFindings("/tmp", noopLogger);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/not parseable/);
  });

  it("parses a clean osv-scanner JSON result and groups vulnerabilities", async () => {
    const sample = {
      results: [{
        source: { path: "package-lock.json" },
        packages: [{
          package: { name: "lodash", version: "4.17.20", ecosystem: "npm" },
          vulnerabilities: [
            { id: "GHSA-xxxx-xxxx-1111", aliases: ["CVE-2021-23337"], summary: "Command injection", database_specific: { severity: "HIGH" }, affected: [{ ranges: [{ events: [{ fixed: "4.17.21" }] }] }] },
          ],
          groups: [{ ids: ["GHSA-xxxx-xxxx-1111"], severity: "HIGH" }],
        }],
      }],
    };
    execFileMock.mockResolvedValue({ stdout: JSON.stringify(sample), stderr: "" });

    const r = await collectOsvFindings("/tmp", noopLogger);
    expect(r.available).toBe(true);
    expect(r.total).toBe(1);
    expect(r.vulnerabilities[0]).toMatchObject({
      id: "GHSA-xxxx-xxxx-1111",
      package: "lodash",
      version: "4.17.20",
      severity: "HIGH",
      fixed: "4.17.21",
    });
  });

  it("treats exit code 1 with valid JSON stdout as success (osv exits 1 when vulns are found)", async () => {
    // osv-scanner exits 1 when it finds vulnerabilities — execFile rejects
    // but stdout has the structured output. The collector should parse it.
    const sample = { results: [{ packages: [{ package: { name: "x", version: "1" }, vulnerabilities: [{ id: "CVE-1" }] }] }] };
    const err = Object.assign(new Error("exit 1"), { code: 1, stdout: JSON.stringify(sample), stderr: "" });
    execFileMock.mockRejectedValue(err);

    const r = await collectOsvFindings("/tmp", noopLogger);
    expect(r.available).toBe(true);
    expect(r.total).toBe(1);
  });
});

describe("parseOsvOutput", () => {
  it("flattens nested results.packages.vulnerabilities", () => {
    const raw = {
      results: [
        { packages: [
          { package: { name: "a", version: "1.0" }, vulnerabilities: [{ id: "CVE-1" }, { id: "CVE-2" }] },
          { package: { name: "b", version: "2.0" }, vulnerabilities: [{ id: "CVE-3" }] },
        ] },
      ],
    };
    const r = parseOsvOutput(raw);
    expect(r.total).toBe(3);
    expect(r.vulnerabilities.map(v => v.id)).toEqual(["CVE-1", "CVE-2", "CVE-3"]);
  });

  it("handles empty results gracefully", () => {
    expect(parseOsvOutput({ results: [] })).toEqual({ total: 0, vulnerabilities: [] });
    expect(parseOsvOutput({})).toEqual({ total: 0, vulnerabilities: [] });
  });

  it("prefers group severity over database_specific severity", () => {
    const raw = {
      results: [{
        packages: [{
          package: { name: "x" },
          vulnerabilities: [{ id: "V1", database_specific: { severity: "MEDIUM" } }],
          groups: [{ ids: ["V1"], severity: "CRITICAL" }],
        }],
      }],
    };
    const r = parseOsvOutput(raw);
    expect(r.vulnerabilities[0].severity).toBe("CRITICAL");
  });
});

describe("groupVulnerabilitiesBySeverity", () => {
  it("groups in canonical order (CRITICAL → HIGH → MEDIUM → MODERATE → LOW → UNKNOWN)", () => {
    const groups = groupVulnerabilitiesBySeverity([
      { severity: "MEDIUM" }, { severity: "CRITICAL" }, { severity: "INVALID" }, { severity: "HIGH" },
    ]);
    expect(Object.keys(groups)).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW", "MODERATE", "UNKNOWN"]);
    expect(groups.CRITICAL).toHaveLength(1);
    expect(groups.HIGH).toHaveLength(1);
    expect(groups.MEDIUM).toHaveLength(1);
    expect(groups.UNKNOWN).toHaveLength(1);
  });
});

describe("buildAuditPrompt — OSV Vulnerabilities section", () => {
  it("omits the section when osvFindings is null or empty", () => {
    const a = buildAuditPrompt({ task: "audit", osvFindings: null });
    const b = buildAuditPrompt({ task: "audit", osvFindings: { available: true, total: 0, vulnerabilities: [] } });
    const c = buildAuditPrompt({ task: "audit", osvFindings: { available: false, reason: "not installed" } });
    expect(a).not.toContain("## OSV Vulnerabilities");
    expect(b).not.toContain("## OSV Vulnerabilities");
    expect(c).not.toContain("## OSV Vulnerabilities");
  });

  it("renders findings grouped by severity with package + version + fixed version", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      osvFindings: {
        available: true,
        total: 2,
        vulnerabilities: [
          { id: "GHSA-aaaa", package: "lodash", version: "4.17.20", severity: "HIGH", summary: "command injection", fixed: "4.17.21" },
          { id: "CVE-2024-9999", package: "axios", version: "0.21.0", severity: "CRITICAL", summary: "ssrf", fixed: "1.7.4" },
        ],
      },
    });
    expect(prompt).toContain("## OSV Vulnerabilities");
    expect(prompt).toContain("Total open vulnerabilities in dependencies: 2");
    expect(prompt).toContain("### CRITICAL (1)");
    expect(prompt).toContain("### HIGH (1)");
    expect(prompt).toContain("CVE-2024-9999");
    expect(prompt).toContain("axios@0.21.0");
    expect(prompt).toContain("→ fixed in 1.7.4");
    expect(prompt).toContain("These CVE/GHSA findings are GROUND TRUTH");
  });

  it("caps the rendered list at MAX_OSV_VULNS_IN_PROMPT (50) with overflow per severity", () => {
    const vulns = Array.from({ length: 75 }, (_, i) => ({
      id: `CVE-2024-${i}`, package: `pkg${i}`, version: "1.0", severity: "HIGH", summary: "x",
    }));
    const prompt = buildAuditPrompt({
      task: "audit",
      osvFindings: { available: true, total: 75, vulnerabilities: vulns },
    });
    expect(prompt).toContain("Total open vulnerabilities in dependencies: 75");
    expect(prompt).toContain("and 25 more in HIGH");
  });
});
