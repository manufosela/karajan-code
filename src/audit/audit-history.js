// KJC-TSK-0472 — Per-project audit history (sqlite).
// Persists every `kj audit` run under <projectDir>/.karajan/audit-history.db.
// Filesystem-first: no external service, metadata + pointer to raw report.
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

const SCHEMA_VERSION = 1;

export function getAuditHistoryDbPath(projectDir) {
  return path.join(projectDir, ".karajan", "audit-history.db");
}

export function openAuditHistoryDb(projectDir) {
  const dbPath = getAuditHistoryDbPath(projectDir);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.pragma("user_version", { simple: true });
  if (current >= SCHEMA_VERSION) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS audits (
      run_id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      git_sha TEXT,
      score INTEGER,
      grade TEXT,
      categories_json TEXT,
      raw_report_path TEXT
    );
    CREATE TABLE IF NOT EXISTS findings (
      run_id TEXT NOT NULL,
      category TEXT,
      check_id TEXT,
      status TEXT,
      weight REAL,
      FOREIGN KEY(run_id) REFERENCES audits(run_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_audits_timestamp ON audits(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_findings_run_id ON findings(run_id);
  `);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

// `harness` may be null when --no-harness or docker offline: row still
// inserted with NULL score/grade so the timeline stays complete.
export function recordAuditRun(db, { runId, timestamp, gitSha, harness, rawReportPath }) {
  const categories = harness?.categories ? JSON.stringify(harness.categories) : null;
  const checks = Array.isArray(harness?.checks) ? harness.checks : [];
  const insertRun = db.prepare(`INSERT INTO audits (run_id, timestamp, git_sha, score, grade, categories_json, raw_report_path) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertFinding = db.prepare(`INSERT INTO findings (run_id, category, check_id, status, weight) VALUES (?, ?, ?, ?, ?)`);
  db.transaction(() => {
    insertRun.run(runId, timestamp, gitSha || null, harness?.score ?? null, harness?.grade ?? null, categories, rawReportPath || null);
    for (const c of checks) {
      insertFinding.run(runId, c.category || null, c.name || c.id || null, c.passed ? "pass" : "fail", typeof c.weight === "number" ? c.weight : null);
    }
  })();
  return { runId, inserted: 1 + checks.length };
}

export function listRecentRuns(db, limit = 10) {
  return db.prepare(`SELECT run_id, timestamp, git_sha, score, grade FROM audits ORDER BY timestamp DESC LIMIT ?`).all(limit);
}

export function countRuns(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM audits`).get().n;
}

export function pruneOldRuns(db, keep = 50) {
  const ids = db.prepare(`SELECT run_id FROM audits ORDER BY timestamp DESC LIMIT -1 OFFSET ?`).all(keep).map((r) => r.run_id);
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM findings WHERE run_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM audits WHERE run_id IN (${placeholders})`).run(...ids);
  });
  tx();
  return ids.length;
}

// High-level helper used by `kj audit`: opens, inserts, surfaces a prune
// hint above 100 runs, closes. Errors are returned via `ok` so a broken db
// never breaks the audit.
export function persistAuditRun(projectDir, payload) {
  try {
    const db = openAuditHistoryDb(projectDir);
    recordAuditRun(db, payload);
    const n = countRuns(db);
    db.close();
    return { ok: true, total: n, pruneHint: n > 100 };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

