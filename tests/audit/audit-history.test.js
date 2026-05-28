// KJC-TSK-0472 — audit-history sqlite store.
import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  openAuditHistoryDb,
  recordAuditRun,
  listRecentRuns,
  countRuns,
  pruneOldRuns,
  getAuditHistoryDbPath,
  persistAuditRun,
} from "../../src/audit/audit-history.js";

let tmp;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-audit-history-"));
});

function sampleHarness(score = 78) {
  return {
    score, grade: "B",
    categories: { architectural_docs: { score: 16 }, testing_stability: { score: 20 } },
    checks: [
      { name: "ADR present", passed: true, category: "architectural_docs", weight: 5 },
      { name: "AGENTS.md", passed: false, category: "architectural_docs", weight: 3 },
    ],
  };
}

describe("audit-history — KJC-TSK-0472", () => {
  it("creates db + schema on first open", async () => {
    const db = openAuditHistoryDb(tmp);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(["audits", "findings"]));
    db.close();
    await fs.access(getAuditHistoryDbPath(tmp));
  });

  it("recordAuditRun inserts atomic row + per-check findings", () => {
    const db = openAuditHistoryDb(tmp);
    const res = recordAuditRun(db, { runId: "r1", timestamp: "2026-05-28T10:00:00Z", gitSha: "abc1234", harness: sampleHarness(78), rawReportPath: "/tmp/r1.md" });
    expect(res).toMatchObject({ runId: "r1", inserted: 3 });
    const row = db.prepare("SELECT * FROM audits WHERE run_id = ?").get("r1");
    expect(row).toMatchObject({ run_id: "r1", score: 78, grade: "B", raw_report_path: "/tmp/r1.md" });
    expect(JSON.parse(row.categories_json)).toMatchObject({ architectural_docs: { score: 16 } });
    const findings = db.prepare("SELECT * FROM findings WHERE run_id = ? ORDER BY check_id").all("r1");
    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.check_id === "AGENTS.md")?.status).toBe("fail");
    db.close();
  });

  it("recordAuditRun with no harness inserts row with null score (skipped scorecard)", () => {
    const db = openAuditHistoryDb(tmp);
    recordAuditRun(db, { runId: "r1", timestamp: "2026-05-28T10:00:00Z", gitSha: null, harness: null, rawReportPath: null });
    const row = db.prepare("SELECT * FROM audits WHERE run_id = ?").get("r1");
    expect(row).toMatchObject({ run_id: "r1", score: null, grade: null, categories_json: null });
    expect(db.prepare("SELECT COUNT(*) AS n FROM findings").get().n).toBe(0);
    db.close();
  });

  it("listRecentRuns returns up to N rows sorted by timestamp DESC", () => {
    const db = openAuditHistoryDb(tmp);
    for (let i = 1; i <= 5; i++) {
      recordAuditRun(db, { runId: `r${i}`, timestamp: `2026-05-2${i}T10:00:00Z`, gitSha: `sha${i}`, harness: sampleHarness(70 + i), rawReportPath: null });
    }
    const rows = listRecentRuns(db, 3);
    expect(rows.map((r) => r.run_id)).toEqual(["r5", "r4", "r3"]);
    db.close();
  });

  it("persistAuditRun opens+inserts+closes and reports pruneHint when total > 100", () => {
    const r1 = persistAuditRun(tmp, { runId: "r1", timestamp: "2026-05-28T10:00:00Z", gitSha: "a", harness: sampleHarness(), rawReportPath: null });
    expect(r1).toMatchObject({ ok: true, total: 1, pruneHint: false });
    const db = openAuditHistoryDb(tmp);
    for (let i = 2; i <= 102; i++) {
      recordAuditRun(db, { runId: `r${i}`, timestamp: `2026-05-28T10:${String(i).padStart(2, "0")}:00Z`, gitSha: `s${i}`, harness: null, rawReportPath: null });
    }
    db.close();
    const last = persistAuditRun(tmp, { runId: "r103", timestamp: "2026-05-28T11:00:00Z", gitSha: "z", harness: null, rawReportPath: null });
    expect(last).toMatchObject({ ok: true, total: 103, pruneHint: true });
  });

  it("pruneOldRuns keeps the most recent N and cascades findings", () => {
    const db = openAuditHistoryDb(tmp);
    for (let i = 1; i <= 6; i++) {
      recordAuditRun(db, { runId: `r${i}`, timestamp: `2026-05-2${i}T10:00:00Z`, gitSha: `s${i}`, harness: sampleHarness(70 + i), rawReportPath: null });
    }
    const deleted = pruneOldRuns(db, 3);
    expect(deleted).toBe(3);
    expect(countRuns(db)).toBe(3);
    expect(db.prepare("SELECT COUNT(*) AS n FROM findings").get().n).toBe(6); // 3 kept × 2 checks
    db.close();
  });
});
