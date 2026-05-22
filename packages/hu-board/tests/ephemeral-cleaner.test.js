import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import {
  classifyEphemeral,
  findEphemeralProjects,
  cleanupEphemeralProjects,
} from "../src/ephemeral-cleaner.js";

// Fixed clock so the "X.Yh inactive" reason text is reproducible.
const NOW = new Date("2026-05-07T12:00:00.000Z").getTime();
const HOUR = 3_600_000;

function ago(hours) {
  return new Date(NOW - hours * HOUR).toISOString();
}

describe("classifyEphemeral (KJC-TSK-0371 — board polish #3)", () => {
  const ctx = { now: NOW, ttlHours: 24 };

  it("returns false on missing/empty input", () => {
    expect(classifyEphemeral(null, ctx).ephemeral).toBe(false);
    expect(classifyEphemeral({}, ctx).ephemeral).toBe(false);
  });

  it.each([
    ["tmp_home_user_kjtest", true],
    ["test_foo", true],
    ["demo_bar", true],
    ["kj-test-1", true],
    ["auto-tmp_home_user_kjtest", true],
    ["my-real-project", false],
    ["linux-assistant-orchestrator", false],
    // case-insensitive
    ["TMP_FOO", true],
    ["Test_bar", true],
    // KJC-TSK-0377: session/plan-prefixed projects (no projectDir at run time)
    ["s_2026-04-29T09-42-14-000Z", true],
    ["plan-20260429094214-0srv", true],
    ["S_FOO", true],
    ["Plan-XYZ", true],
  ])("id-pattern heuristic: %s → %s (when stale)", (id, expected) => {
    const project = { id, last_activity: ago(48), is_test: null };
    expect(classifyEphemeral(project, ctx).ephemeral).toBe(expected);
  });

  it("respects user override is_test=0 (NEVER auto-clean)", () => {
    // The id matches the heuristic AND it's old, but the user said "keep".
    const project = { id: "tmp_keepme", last_activity: ago(48), is_test: 0 };
    expect(classifyEphemeral(project, ctx).ephemeral).toBe(false);
  });

  it("treats is_test=1 as ephemeral even when id does NOT match the heuristic", () => {
    // Real-looking id, but user explicitly tagged it as test.
    const project = { id: "my-real-looking-name", last_activity: ago(48), is_test: 1 };
    expect(classifyEphemeral(project, ctx).ephemeral).toBe(true);
    expect(classifyEphemeral(project, ctx).reason).toMatch(/is_test=1/);
  });

  it("does NOT clean projects within the TTL window", () => {
    const project = { id: "tmp_recent", last_activity: ago(2), is_test: null };
    expect(classifyEphemeral(project, ctx).ephemeral).toBe(false);
  });

  it("falls back to first_seen when last_activity is absent", () => {
    const project = { id: "tmp_nolast", first_seen: ago(48), last_activity: null, is_test: null };
    expect(classifyEphemeral(project, ctx).ephemeral).toBe(true);
  });

  it("returns false on garbage timestamps", () => {
    const project = { id: "tmp_bad", last_activity: "not-a-date", is_test: null };
    expect(classifyEphemeral(project, ctx).ephemeral).toBe(false);
  });

  it("returns false on future timestamps (defensive)", () => {
    const project = { id: "tmp_future", last_activity: ago(-2), is_test: null };
    expect(classifyEphemeral(project, ctx).ephemeral).toBe(false);
  });

  it("includes the inactivity duration in the reason text", () => {
    const v = classifyEphemeral({ id: "tmp_old", last_activity: ago(72), is_test: null }, ctx);
    expect(v.ephemeral).toBe(true);
    expect(v.reason).toMatch(/72\.0h/);
    expect(v.reason).toMatch(/id heuristic/);
  });
});

describe("findEphemeralProjects", () => {
  it("returns [] on empty/null input", () => {
    expect(findEphemeralProjects([], { now: NOW })).toEqual([]);
    expect(findEphemeralProjects(null, { now: NOW })).toEqual([]);
  });

  it("filters only the ephemeral ones, preserving the reason", () => {
    const projects = [
      { id: "tmp_old",  last_activity: ago(48), is_test: null },
      { id: "real-a",   last_activity: ago(48), is_test: null },
      { id: "demo_old", last_activity: ago(72), is_test: null },
      { id: "tmp_keep", last_activity: ago(48), is_test: 0 },     // user override
      { id: "real-b",   last_activity: ago(48), is_test: 1 },     // explicit test
    ];
    const found = findEphemeralProjects(projects, { now: NOW });
    expect(found.map((f) => f.project.id).sort()).toEqual(["demo_old", "real-b", "tmp_old"]);
  });

  it("respects custom ttlHours via opts", () => {
    const projects = [{ id: "tmp_2h", last_activity: ago(2), is_test: null }];
    expect(findEphemeralProjects(projects, { now: NOW, ttlHours: 24 })).toHaveLength(0);
    expect(findEphemeralProjects(projects, { now: NOW, ttlHours: 1 })).toHaveLength(1);
  });
});

describe("cleanupEphemeralProjects (integration with in-memory SQLite)", () => {
  let db;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT,
        first_seen TEXT,
        last_activity TEXT,
        total_stories INTEGER DEFAULT 0,
        is_test INTEGER
      );
      CREATE TABLE stories (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        status TEXT
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        status TEXT
      );
    `);
  });

  afterEach(() => db.close());

  function insertProject(row) {
    db.prepare(
      "INSERT INTO projects (id, name, first_seen, last_activity, is_test) VALUES (?, ?, ?, ?, ?)"
    ).run(row.id, row.name || row.id, row.first_seen || row.last_activity, row.last_activity, row.is_test ?? null);
  }

  function insertStory(id, projectId) {
    db.prepare("INSERT INTO stories (id, project_id, status) VALUES (?, ?, ?)").run(id, projectId, "pending");
  }

  function insertSession(id, projectId) {
    db.prepare("INSERT INTO sessions (id, project_id, status) VALUES (?, ?, ?)").run(id, projectId, "approved");
  }

  it("returns [] when nothing matches", () => {
    insertProject({ id: "real_one", last_activity: ago(48) });
    expect(cleanupEphemeralProjects({ db, now: () => NOW })).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM projects").get().n).toBe(1);
  });

  it("cascade-deletes the project + its stories + sessions", () => {
    insertProject({ id: "tmp_old", last_activity: ago(48) });
    insertStory("s1", "tmp_old");
    insertStory("s2", "tmp_old");
    insertSession("se1", "tmp_old");

    const cleaned = cleanupEphemeralProjects({ db, now: () => NOW });
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].id).toBe("tmp_old");
    expect(cleaned[0].stories_deleted).toBe(2);
    expect(cleaned[0].sessions_deleted).toBe(1);

    expect(db.prepare("SELECT id FROM projects WHERE id = 'tmp_old'").get()).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM stories").get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n).toBe(0);
  });

  it("respects user override is_test=0 (project survives even when stale)", () => {
    insertProject({ id: "tmp_keepme", last_activity: ago(72), is_test: 0 });
    insertStory("s1", "tmp_keepme");

    const cleaned = cleanupEphemeralProjects({ db, now: () => NOW });
    expect(cleaned).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM projects").get().n).toBe(1);
  });

  it("does NOT touch real-named projects, even when very old", () => {
    insertProject({ id: "linux-assistant-orchestrator", last_activity: ago(7 * 24) });
    expect(cleanupEphemeralProjects({ db, now: () => NOW })).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM projects").get().n).toBe(1);
  });

  it("is idempotent — second pass is a no-op", () => {
    insertProject({ id: "tmp_old", last_activity: ago(48) });
    expect(cleanupEphemeralProjects({ db, now: () => NOW })).toHaveLength(1);
    expect(cleanupEphemeralProjects({ db, now: () => NOW })).toHaveLength(0);
  });

  it("processes multiple ephemeral projects in a single pass", () => {
    insertProject({ id: "tmp_a", last_activity: ago(48) });
    insertProject({ id: "test_b", last_activity: ago(48) });
    insertProject({ id: "demo_c", last_activity: ago(48) });
    insertProject({ id: "real_d", last_activity: ago(48) });

    const cleaned = cleanupEphemeralProjects({ db, now: () => NOW });
    expect(cleaned.map((c) => c.id).sort()).toEqual(["demo_c", "test_b", "tmp_a"]);
    expect(db.prepare("SELECT id FROM projects").all().map((r) => r.id)).toEqual(["real_d"]);
  });

  // KJC-BUG-0055: cleanup must tombstone + rm-rf the on-disk artefacts,
  // not just drop DB rows. Without this, the very next chokidar `add`
  // (or the next boot's fullScan) would re-import the surviving files
  // as a ghost project.
  it("tombstones the project + its children AND removes their fs paths", () => {
    insertProject({ id: "tmp_zombie", last_activity: ago(48) });
    insertStory("story_x", "tmp_zombie");
    insertSession("sess_x", "tmp_zombie");

    const tombstoneCalls = [];
    const tombstone = (type, id, opts) => tombstoneCalls.push({ type, id, opts });
    const removedPaths = [];
    const realRm = fs.rmSync;
    fs.rmSync = (p) => { removedPaths.push(p); };
    try {
      cleanupEphemeralProjects({
        db,
        now: () => NOW,
        tombstone,
        kjHome: () => "/fake/home",
      });
    } finally {
      fs.rmSync = realRm;
    }

    expect(tombstoneCalls.map((c) => `${c.type}:${c.id}`).sort()).toEqual([
      "project:tmp_zombie",
      "session:sess_x",
      "story:story_x",
    ]);
    expect(removedPaths).toContain("/fake/home/hu-stories/story_x");
    expect(removedPaths).toContain("/fake/home/sessions/sess_x");
  });
});
