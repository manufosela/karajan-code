import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../src/db.js";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-db-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openDatabase — better-sqlite3 parity over node:sqlite (KJC-TSK-0615)", () => {
  it("prepare().run/get/all match the better-sqlite3 surface", () => {
    const db = openDatabase(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    const info = db.prepare("INSERT INTO t (name) VALUES (?)").run("uno");
    expect(Number(info.changes)).toBe(1);
    expect(Number(info.lastInsertRowid)).toBe(1);
    db.prepare("INSERT INTO t (name) VALUES (?)").run("dos");
    expect(db.prepare("SELECT name FROM t WHERE id = ?").get(2).name).toBe("dos");
    expect(db.prepare("SELECT name FROM t ORDER BY id").all().map((r) => r.name)).toEqual(["uno", "dos"]);
    db.close();
  });

  it("persists to a file on disk", () => {
    const file = join(dir, "test.db");
    const db = openDatabase(file);
    db.exec("CREATE TABLE t (a TEXT)");
    db.prepare("INSERT INTO t VALUES (?)").run("persistido");
    db.close();
    expect(existsSync(file)).toBe(true);
    const again = openDatabase(file);
    expect(again.prepare("SELECT a FROM t").get().a).toBe("persistido");
    again.close();
  });

  it("pragma supports assignments and simple reads (the shapes karajan uses)", () => {
    const db = openDatabase(join(dir, "p.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("user_version = 7");
    expect(db.pragma("user_version", { simple: true })).toBe(7);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    // non-simple returns rows, better-sqlite3 style
    expect(db.pragma("user_version")).toEqual([{ user_version: 7 }]);
    db.close();
  });

  it("transaction commits on success and rolls back on throw", () => {
    const db = openDatabase(":memory:");
    db.exec("CREATE TABLE t (a TEXT)");
    const insertTwo = db.transaction((x, y) => {
      db.prepare("INSERT INTO t VALUES (?)").run(x);
      db.prepare("INSERT INTO t VALUES (?)").run(y);
      return "done";
    });
    expect(insertTwo("a", "b")).toBe("done");
    expect(db.prepare("SELECT COUNT(*) c FROM t").get().c).toBe(2);

    const failing = db.transaction(() => {
      db.prepare("INSERT INTO t VALUES (?)").run("c");
      throw new Error("boom");
    });
    expect(() => failing()).toThrow("boom");
    // rollback: "c" never landed
    expect(db.prepare("SELECT COUNT(*) c FROM t").get().c).toBe(2);
    db.close();
  });

  it("loads the sqlite-vec extension and answers a vector query", async () => {
    let loadablePath;
    try {
      const sv = await import("sqlite-vec");
      loadablePath = sv.getLoadablePath();
    } catch {
      return; // platform package unavailable — nothing to assert here
    }
    const db = openDatabase(":memory:", { allowExtension: true });
    db.loadExtension(loadablePath);
    const { v } = db.prepare("SELECT vec_version() AS v").get();
    expect(v).toMatch(/^v?\d+\./);
    db.close();
  });

  it("does not leak the node:sqlite ExperimentalWarning", async () => {
    const warnings = [];
    const listener = (w) => warnings.push(String(w?.message ?? w));
    process.on("warning", listener);
    try {
      const db = openDatabase(":memory:");
      db.exec("CREATE TABLE t (a TEXT)");
      db.close();
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", listener);
    }
    expect(warnings.filter((w) => w.includes("SQLite is an experimental feature"))).toEqual([]);
  });
});
