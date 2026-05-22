import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb, closeDb } from "../src/db.js";

// Resilience audit, Phase 3: the board's SQLite was a single point of
// failure — no busy_timeout (SQLITE_BUSY crashed the request), no
// schema version (a newer DB silently mis-bound named parameters
// against renamed columns), no recovery on corruption (a half-written
// WAL crashed the whole board at startup).

let kjHome;

beforeEach(() => {
  kjHome = mkdtempSync(join(tmpdir(), "kj-db-hard-"));
  process.env.KJ_HOME = kjHome;
});

afterEach(() => {
  try { closeDb(); } catch { /* may already be closed */ }
  delete process.env.KJ_HOME;
  rmSync(kjHome, { recursive: true, force: true });
});

describe("hu-board db hardening", () => {
  it("sets busy_timeout so concurrent writers wait instead of crashing", () => {
    const db = initDb();
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
  });

  it("stamps user_version on a fresh DB", () => {
    const db = initDb();
    expect(db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(1);
  });

  it("recovers from a corrupt DB file: moves it aside and opens a fresh one", () => {
    const dbPath = join(kjHome, "hu-board.db");
    writeFileSync(dbPath, "this is not a valid sqlite database");

    const db = initDb();

    expect(db).toBeTruthy();
    // initDb returned a working handle — read a pragma to prove it.
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    // The corrupt file was moved aside (not deleted).
    const files = readdirSync(kjHome);
    expect(files.some((f) => f.startsWith("hu-board.db.corrupt-"))).toBe(true);
    expect(existsSync(dbPath)).toBe(true); // fresh DB took its place
  });

  it("refuses to open a DB written by a newer Karajan (user_version > current)", () => {
    const db = initDb();
    db.pragma("user_version = 99");
    closeDb();

    expect(() => initDb()).toThrow(/schema is from a newer Karajan/);
  });
});
