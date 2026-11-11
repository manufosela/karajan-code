// HU-3799 (5a): the reader's record is atomic, refuses a corrupt file and a path trick, and holds no body.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RecordError, loadRecord, markRead, recordPath, saveRecord } from "../../src/link/record.js";

const thread = { kind: "issue", number: 7 };
const root = () => mkdtempSync(join(tmpdir(), "kj-link-"));
const files = (dir) => readdirSync(join(dir, ".karajan", "link"));

describe("the record", () => {
  it("starts empty, round-trips and merges what was read", () => {
    const dir = root();
    expect(loadRecord(dir, thread)).toEqual({ cursor: null, seen: {} });
    const a = { updatedAt: "t1", hash: "h1" };
    const b = { updatedAt: "t2", hash: "h2" };
    const next = markRead({ cursor: "c1", seen: { 1: a } }, { cursor: "c2", seen: { 2: b } });
    expect(next).toEqual({ cursor: "c2", seen: { 1: a, 2: b } });
    saveRecord(dir, thread, next);
    expect(loadRecord(dir, thread)).toEqual(next);
    expect(files(dir)).toEqual(["issue-7.json"]);
  });
  it("saves only cursor and seen, dropping anything else a caller put in", () => {
    const dir = root();
    saveRecord(dir, thread, { cursor: "c", seen: { 1: { updatedAt: "t", hash: "h", body: "LEAK" } }, body: "LEAK" });
    expect(readFileSync(recordPath(dir, thread), "utf8")).not.toContain("LEAK");
  });
  it.each([["not json"], ['{"cursor":1,"seen":[]}'], ['{"cursor":"c","seen":{"1":{"updatedAt":"t"}}}'], ["null"]])("refuses a corrupt record %s without resetting it", (content) => {
    const dir = root();
    mkdirSync(join(dir, ".karajan", "link"), { recursive: true });
    writeFileSync(recordPath(dir, thread), content);
    expect(() => loadRecord(dir, thread)).toThrow(RecordError);
    expect(readFileSync(recordPath(dir, thread), "utf8")).toBe(content);
  });
  it("keeps the old record when the process dies between the temporary write and the rename", () => {
    const dir = root();
    saveRecord(dir, thread, { cursor: "old", seen: {} });
    const crashing = { ...nodeFs, renameSync: () => { throw new Error("crash"); } };
    expect(() => saveRecord(dir, thread, { cursor: "new", seen: {} }, { fs: crashing })).toThrow("crash");
    expect(loadRecord(dir, thread).cursor).toBe("old");
    expect(files(dir)).toEqual(["issue-7.json"]);
  });
  it.each([[{ kind: "../x", number: 1 }], [{ kind: "issue", number: "1/../2" }], [{ kind: "issue", number: 0 }], [{ kind: "issue", number: -3 }], [{ kind: "Issue", number: 1 }], [{ kind: "issue", number: 1.5 }], ["../../etc"], [null]])("refuses the thread key %j", (bad) => {
    expect(() => recordPath(root(), bad)).toThrow(RecordError);
  });
});
