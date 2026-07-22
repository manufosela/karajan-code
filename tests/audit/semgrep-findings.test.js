import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// KJC-TSK-0668: the collector runs through the tool governor now — mock it
// so tests drive the same {stdout}/rejection contract without real spawns.
const execFileMock = vi.fn();

vi.mock("../../src/utils/tool-governor.js", () => ({
  runGoverned: (...args) => Promise.resolve(execFileMock(...args)),
  jobsCap: () => 4,
}));

import { collectSemgrepFindings, parseSemgrepOutput, groupFindingsBySeverity } from "../../src/audit/semgrep-findings.js";
import { buildAuditPrompt } from "../../src/prompts/audit.js";

const noopLogger = { warn: vi.fn(), info: vi.fn() };

describe("collectSemgrepFindings (KJC-TSK-0366)", () => {
  beforeEach(() => { vi.resetAllMocks(); process.env.KJ_ALLOW_REAL_SCANS = "1"; });
  afterEach(() => { delete process.env.KJ_ALLOW_REAL_SCANS; });

  // KJC-BUG-0122: the kill-switch — under the test runner, without the
  // explicit opt-in, the collector never spawns anything.
  it("refuses to scan under VITEST without KJ_ALLOW_REAL_SCANS", async () => {
    delete process.env.KJ_ALLOW_REAL_SCANS;
    const r = await collectSemgrepFindings(".", noopLogger);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/disabled under the test runner/);
    expect(execFileMock).not.toHaveBeenCalled();
  });


  it("returns available=false when semgrep is not installed (ENOENT)", async () => {
    const enoErr = Object.assign(new Error("not found"), { code: "ENOENT" });
    execFileMock.mockRejectedValue(enoErr);

    const r = await collectSemgrepFindings("/tmp", noopLogger);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/not installed/);
    expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringContaining("semgrep not found"));
  });

  it("returns available=false when scan times out", async () => {
    const timeoutErr = Object.assign(new Error("killed"), { killed: true });
    execFileMock.mockRejectedValue(timeoutErr);

    const r = await collectSemgrepFindings("/tmp", noopLogger);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/timed out/);
  });

  it("returns available=false when output is unparseable", async () => {
    execFileMock.mockResolvedValue({ stdout: "junk { not valid", stderr: "" });

    const r = await collectSemgrepFindings("/tmp", noopLogger);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/not parseable/);
  });

  it("parses a clean semgrep --json result and surfaces findings", async () => {
    const sample = {
      results: [
        { check_id: "javascript.express.security.audit.xss.direct-response-write.direct-response-write",
          path: "/tmp/src/route.js", start: { line: 42 }, end: { line: 45 },
          extra: { severity: "ERROR", message: "Untrusted input flows into res.write", metadata: { cwe: ["CWE-79"], owasp: ["A03:2021"] } } },
        { check_id: "javascript.lang.security.audit.unsafe-formatstring",
          path: "/tmp/src/log.js", start: { line: 10 }, end: { line: 11 },
          extra: { severity: "WARNING", message: "Format string with user input" } },
      ],
    };
    execFileMock.mockResolvedValue({ stdout: JSON.stringify(sample), stderr: "" });

    const r = await collectSemgrepFindings("/tmp", noopLogger);
    expect(r.available).toBe(true);
    expect(r.total).toBe(2);
    expect(r.findings[0]).toMatchObject({
      rule: "javascript.express.security.audit.xss.direct-response-write.direct-response-write",
      severity: "ERROR",
      file: "src/route.js", // path made relative to /tmp
      line: 42,
    });
    expect(r.findings[0].cwe).toEqual(["CWE-79"]);
  });

  it("rescues exit code 1 with valid JSON stdout (semgrep exits 1 when ERROR rules fire)", async () => {
    const sample = { results: [{ check_id: "X", path: "a.js", start: { line: 1 }, end: { line: 1 }, extra: { severity: "ERROR" } }] };
    const err = Object.assign(new Error("exit 1"), { code: 1, stdout: JSON.stringify(sample), stderr: "" });
    execFileMock.mockRejectedValue(err);

    const r = await collectSemgrepFindings("/tmp", noopLogger);
    expect(r.available).toBe(true);
    expect(r.total).toBe(1);
  });
});

describe("parseSemgrepOutput", () => {
  it("makes paths relative to projectDir", () => {
    const raw = { results: [{ check_id: "x", path: "/proj/src/a.js", start: { line: 1 }, end: { line: 1 }, extra: { severity: "INFO" } }] };
    const r = parseSemgrepOutput(raw, "/proj");
    expect(r.findings[0].file).toBe("src/a.js");
  });

  it("normalises missing severity to INFO and handles empty results", () => {
    expect(parseSemgrepOutput({}).total).toBe(0);
    const r = parseSemgrepOutput({ results: [{ check_id: "x", path: "a.js", start: { line: 1 }, end: { line: 1 }, extra: {} }] });
    expect(r.findings[0].severity).toBe("INFO");
  });
});

describe("groupFindingsBySeverity", () => {
  it("groups in canonical order ERROR → WARNING → INFO", () => {
    const groups = groupFindingsBySeverity([
      { severity: "WARNING" }, { severity: "ERROR" }, { severity: "INFO" }, { severity: "WARNING" },
    ]);
    expect(Object.keys(groups)).toEqual(["ERROR", "WARNING", "INFO"]);
    expect(groups.ERROR).toHaveLength(1);
    expect(groups.WARNING).toHaveLength(2);
    expect(groups.INFO).toHaveLength(1);
  });

  it("buckets unknown severity into INFO", () => {
    const groups = groupFindingsBySeverity([{ severity: "FOO" }, {}]);
    expect(groups.INFO).toHaveLength(2);
  });
});

describe("buildAuditPrompt — Semgrep section integration", () => {
  it("omits the section when semgrepFindings is null/empty/unavailable", () => {
    const a = buildAuditPrompt({ task: "audit", semgrepFindings: null });
    const b = buildAuditPrompt({ task: "audit", semgrepFindings: { available: true, total: 0, findings: [] } });
    const c = buildAuditPrompt({ task: "audit", semgrepFindings: { available: false, reason: "not installed" } });
    expect(a).not.toContain("## Semgrep SAST Findings");
    expect(b).not.toContain("## Semgrep SAST Findings");
    expect(c).not.toContain("## Semgrep SAST Findings");
  });

  it("renders findings grouped by severity with rule + location", () => {
    const prompt = buildAuditPrompt({
      task: "audit",
      semgrepFindings: {
        available: true,
        total: 2,
        findings: [
          { rule: "javascript.express.xss", severity: "ERROR", file: "src/route.js", line: 42, message: "XSS" },
          { rule: "javascript.lang.format", severity: "WARNING", file: "src/log.js", line: 10, message: "format string" },
        ],
      },
    });
    expect(prompt).toContain("## Semgrep SAST Findings");
    expect(prompt).toContain("Total findings: 2");
    expect(prompt).toContain("### ERROR (1)");
    expect(prompt).toContain("### WARNING (1)");
    expect(prompt).toContain("javascript.express.xss");
    expect(prompt).toContain("src/route.js:42");
    expect(prompt).toContain("These SAST findings are GROUND TRUTH");
  });

  it("caps the rendered list at MAX_SEMGREP_FINDINGS_IN_PROMPT (50) with overflow per severity", () => {
    const findings = Array.from({ length: 75 }, (_, i) => ({
      rule: `rule${i}`, severity: "ERROR", file: `f${i}.js`, line: i, message: "x",
    }));
    const prompt = buildAuditPrompt({
      task: "audit",
      semgrepFindings: { available: true, total: 75, findings },
    });
    expect(prompt).toContain("Total findings: 75");
    expect(prompt).toContain("and 25 more in ERROR");
  });
});
