import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  classifyZombie,
  findZombieSessions,
  appendZombieCheckpoint,
  reapZombieSessions,
} from "../src/zombie-reaper.js";

const NOW = new Date("2026-05-07T10:00:00.000Z").getTime();
const HOUR = 3_600_000;

function ago(hours) {
  return new Date(NOW - hours * HOUR).toISOString();
}

describe("classifyZombie (KJC board polish #2)", () => {
  const ctx = { now: NOW, codingHours: 6, pausedHours: 24 };

  it("returns false on missing/empty input", () => {
    expect(classifyZombie(null, ctx).zombie).toBe(false);
    expect(classifyZombie({}, ctx).zombie).toBe(false);
    expect(classifyZombie({ id: "s1", status: "coding" }, ctx).zombie).toBe(false);
  });

  it("returns false on unparseable timestamps", () => {
    expect(classifyZombie({ id: "s1", status: "coding", updated_at: "garbage" }, ctx).zombie).toBe(false);
  });

  it.each([
    ["coding",       5.99, false],
    ["coding",       6.01, true],
    ["stalled",      6.01, true],
    ["running",      24,   true],
    ["in_progress", 100,   true],
    ["coding",       0,    false],   // brand-new
    ["coding",      -1,    false],   // future timestamp (defensive)
  ])("status=%s after %sh inactive → zombie=%s", (status, hours, expected) => {
    const session = { id: "s1", status, updated_at: ago(hours) };
    expect(classifyZombie(session, ctx).zombie).toBe(expected);
  });

  it.each([
    ["paused",           23,  false],
    ["paused",           25,  true],
    ["checkpoint",       30,  true],
    ["awaiting_answer", 168,  true],
  ])("paused-like status=%s after %sh inactive → zombie=%s", (status, hours, expected) => {
    const session = { id: "s1", status, updated_at: ago(hours) };
    expect(classifyZombie(session, ctx).zombie).toBe(expected);
  });

  it("falls back to created_at when updated_at is absent", () => {
    const session = { id: "s1", status: "coding", created_at: ago(8) };
    expect(classifyZombie(session, ctx).zombie).toBe(true);
  });

  it("ignores terminal statuses (failed, approved)", () => {
    expect(classifyZombie({ id: "s1", status: "failed", updated_at: ago(168) }, ctx).zombie).toBe(false);
    expect(classifyZombie({ id: "s2", status: "approved", updated_at: ago(168) }, ctx).zombie).toBe(false);
  });

  it("includes the reason text with the inactivity duration", () => {
    const v = classifyZombie({ id: "s1", status: "coding", updated_at: ago(9) }, ctx);
    expect(v.zombie).toBe(true);
    expect(v.reason).toMatch(/coding/);
    expect(v.reason).toMatch(/9\.0h/);
  });
});

describe("findZombieSessions", () => {
  it("returns empty array on empty input", () => {
    expect(findZombieSessions([], { now: NOW })).toEqual([]);
    expect(findZombieSessions(null, { now: NOW })).toEqual([]);
  });

  it("filters only the zombies and preserves the reason", () => {
    const sessions = [
      { id: "alive_1",   status: "coding",   updated_at: ago(1) },
      { id: "zombie_a",  status: "coding",   updated_at: ago(8) },
      { id: "alive_2",   status: "approved", updated_at: ago(72) },
      { id: "zombie_b",  status: "paused",   updated_at: ago(48) },
      { id: "alive_3",   status: "paused",   updated_at: ago(2) },
    ];
    const found = findZombieSessions(sessions, { now: NOW });
    expect(found.map((z) => z.session.id)).toEqual(["zombie_a", "zombie_b"]);
    expect(found[0].reason).toMatch(/coding/);
    expect(found[1].reason).toMatch(/paused/);
  });

  it("respects custom thresholds", () => {
    const sessions = [
      { id: "s_strict", status: "coding", updated_at: ago(2) },
    ];
    expect(findZombieSessions(sessions, { now: NOW, codingHours: 6 })).toHaveLength(0);
    expect(findZombieSessions(sessions, { now: NOW, codingHours: 1 })).toHaveLength(1);
  });
});

describe("appendZombieCheckpoint", () => {
  it("creates a fresh array when checkpoints is null", () => {
    const out = appendZombieCheckpoint(null, "reason", "2026-05-07T10:00Z");
    expect(JSON.parse(out)).toEqual([{ stage: "zombie-reap", reason: "reason", at: "2026-05-07T10:00Z" }]);
  });

  it("appends to an existing array", () => {
    const existing = JSON.stringify([{ stage: "coder-start", at: "2026-04-29T10:00Z" }]);
    const out = appendZombieCheckpoint(existing, "8h coding", "2026-05-07T10:00Z");
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual({ stage: "zombie-reap", reason: "8h coding", at: "2026-05-07T10:00Z" });
  });

  it("recovers gracefully from corrupt JSON", () => {
    const out = appendZombieCheckpoint("not json", "fallback", "2026-05-07T10:00Z");
    expect(JSON.parse(out)).toEqual([{ stage: "zombie-reap", reason: "fallback", at: "2026-05-07T10:00Z" }]);
  });

  it("rejects non-array JSON (replaces with fresh array)", () => {
    const out = appendZombieCheckpoint(JSON.stringify({ not: "an array" }), "x", "2026-05-07T10:00Z");
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });
});

describe("reapZombieSessions (integration with in-memory SQLite)", () => {
  let db;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        updated_at TEXT,
        created_at TEXT,
        checkpoints TEXT
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  function insert(row) {
    db.prepare(
      "INSERT INTO sessions (id, status, updated_at, created_at, checkpoints) VALUES (?, ?, ?, ?, ?)",
    ).run(row.id, row.status, row.updated_at, row.created_at, row.checkpoints || null);
  }

  it("returns [] when nothing to reap", () => {
    insert({ id: "s_alive", status: "coding", updated_at: ago(1) });
    const reaped = reapZombieSessions({ db, now: () => NOW });
    expect(reaped).toEqual([]);
    expect(db.prepare("SELECT status FROM sessions WHERE id = 's_alive'").get().status).toBe("coding");
  });

  it("flips zombie sessions to status='failed' and appends a checkpoint", () => {
    insert({ id: "s_zombie", status: "coding", updated_at: ago(8), checkpoints: JSON.stringify([{ stage: "coder-start" }]) });
    const reaped = reapZombieSessions({ db, now: () => NOW });
    expect(reaped).toHaveLength(1);
    expect(reaped[0].id).toBe("s_zombie");
    expect(reaped[0].status_before).toBe("coding");

    const row = db.prepare("SELECT * FROM sessions WHERE id = 's_zombie'").get();
    expect(row.status).toBe("failed");
    const checkpoints = JSON.parse(row.checkpoints);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[1].stage).toBe("zombie-reap");
    expect(checkpoints[1].reason).toMatch(/coding/);
    // updated_at was bumped to the reap timestamp
    expect(row.updated_at).toBe(new Date(NOW).toISOString());
  });

  it("does not touch terminal statuses (failed/approved/cancelled/done)", () => {
    insert({ id: "s_failed",    status: "failed",    updated_at: ago(168) });
    insert({ id: "s_approved",  status: "approved",  updated_at: ago(168) });
    insert({ id: "s_cancelled", status: "cancelled", updated_at: ago(168) });
    insert({ id: "s_done",      status: "done",      updated_at: ago(168) });
    const reaped = reapZombieSessions({ db, now: () => NOW });
    expect(reaped).toEqual([]);
  });

  it("respects the configured thresholds via opts", () => {
    insert({ id: "s_recent_coding", status: "coding", updated_at: ago(2) });
    expect(reapZombieSessions({ db, opts: { codingHours: 6 }, now: () => NOW })).toHaveLength(0);
    expect(reapZombieSessions({ db, opts: { codingHours: 1 }, now: () => NOW })).toHaveLength(1);
  });

  it("is idempotent: reaped sessions are not reaped again", () => {
    insert({ id: "s_zombie", status: "coding", updated_at: ago(8) });
    expect(reapZombieSessions({ db, now: () => NOW })).toHaveLength(1);
    expect(reapZombieSessions({ db, now: () => NOW })).toHaveLength(0);  // already failed
  });
});
