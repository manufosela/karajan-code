// KJC-TSK-0471 — kj audit harness section (run + format).
import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("../../src/audit/harness-scorecard.js", () => ({
  normalizeHarnessConfig: vi.fn((h = {}) => ({
    enabled: h.enabled !== false,
    image: h.image || "img:latest",
  })),
  runHarnessAssess: vi.fn(),
}));
import { runHarnessAssess } from "../../src/audit/harness-scorecard.js";
import { runHarnessSection, formatHarnessSection } from "../../src/audit/harness-section.js";

describe("audit/harness-section — KJC-TSK-0471", () => {
  let tmp;
  beforeEach(async () => {
    runHarnessAssess.mockReset();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-harness-"));
  });

  it("skipped when disabled in config", async () => {
    const r = await runHarnessSection({ projectDir: tmp, harnessConfig: { enabled: false } });
    expect(r).toMatchObject({ ok: true, skipped: true, reason: "disabled" });
    expect(runHarnessAssess).not.toHaveBeenCalled();
  });

  it("persists scorecard.json + scorecard-report.md under .karajan/audit-runs", async () => {
    runHarnessAssess.mockResolvedValueOnce({
      ok: true, score: 78, grade: "B",
      raw: { overall_score: 78, grade: "B", categories: {}, checks: [], report_markdown: "# Report\n" },
    });
    const r = await runHarnessSection({ projectDir: tmp });
    expect(r).toMatchObject({ ok: true, score: 78, grade: "B" });
    expect(r.scorecardPath).toMatch(/\.karajan[\\/]audit-runs[\\/].+[\\/]scorecard\.json$/);
    expect(await fs.readFile(r.scorecardPath, "utf8")).toContain('"overall_score": 78');
    expect(await fs.readFile(r.rawReportPath, "utf8")).toBe("# Report\n");
  });

  it("surfaces runHarnessAssess failure without throwing", async () => {
    runHarnessAssess.mockResolvedValueOnce({ ok: false, error: "boom" });
    expect(await runHarnessSection({ projectDir: tmp })).toMatchObject({ ok: false, error: "boom" });
  });

  it("formatHarnessSection renders header + 5-row category table", () => {
    const md = formatHarnessSection({
      ok: true, score: 78, grade: "B",
      categories: { architectural_docs: { score: 16 }, testing_stability: { score: 20 } },
      checks: [],
    });
    expect(md).toMatch(/Harness Health Score: 78\/100 \(B\)/);
    expect(md).toMatch(/Architectural Docs \| 20% \| 16/);
    expect(md).toMatch(/Testing & Stability \| 25% \| 20/);
    expect(md).toMatch(/Review & Drift Prevention \| 15% \| —/);
  });

  it("formatHarnessSection groups checks by category with pass/fail marks", () => {
    const md = formatHarnessSection({
      ok: true, score: 50, grade: "C", categories: {},
      checks: [
        { name: "ADR present", passed: true, category: "architectural_docs" },
        { name: "AGENTS.md", passed: false, category: "architectural_docs", detail: "missing" },
      ],
    });
    expect(md).toMatch(/✓ ADR present/);
    expect(md).toMatch(/✗ AGENTS\.md — missing/);
  });

  it("formatHarnessSection notes the failure when ok=false", () => {
    expect(formatHarnessSection({ ok: false, error: "docker offline" })).toMatch(/skipped: docker offline/);
  });

  it("formatHarnessSection returns empty when skipped", () => {
    expect(formatHarnessSection({ ok: true, skipped: true, reason: "disabled" })).toBe("");
  });
});
