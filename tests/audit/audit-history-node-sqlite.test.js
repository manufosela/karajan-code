// KJC-TSK-0618 (SQL-D): the audit history and the ONNX fallback probe run on karajan-core's
// node:sqlite adapter. Loading better-sqlite3 at all is a failure.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("better-sqlite3", () => {
  throw new Error("better-sqlite3 must not be loaded");
});

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sqld-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("root SQLite consumers on node:sqlite", () => {
  it("records and lists audit runs", async () => {
    const { openAuditHistoryDb, recordAuditRun, countRuns } = await import("../../src/audit/audit-history.js");
    const db = openAuditHistoryDb(tmp);
    try {
      recordAuditRun(db, {
        runId: "r1",
        timestamp: "2026-11-01T00:00:00Z",
        harness: { score: 90, grade: "A", categories: { a: 1 }, checks: [{ category: "a", name: "c1", passed: true, weight: 1 }] },
      });
      expect(countRuns(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("the ONNX fallback probe deletes an empty store and keeps one with chunks", async () => {
    const { resetEmptyStore } = await import("../../src/rag/onnx-fallback.js");
    const { projectDbPath } = await import("../../src/rag/project-store.js");
    expect(resetEmptyStore(tmp)).toBe(true);
    const store = projectDbPath(tmp);
    fs.mkdirSync(path.dirname(store), { recursive: true });
    const { openDatabase } = await import("karajan-core/db");
    const db = openDatabase(store);
    db.exec("CREATE TABLE chunks (id INTEGER PRIMARY KEY, text TEXT)");
    db.prepare("INSERT INTO chunks (text) VALUES (?)").run("x");
    db.close();
    expect(resetEmptyStore(tmp)).toBe(false);
    expect(fs.existsSync(store)).toBe(true);
  });
});
