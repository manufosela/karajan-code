import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { takeSnapshot, generateSnapshotDiff } from "../src/review/snapshot-diff.js";

let testDir;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "kj-snap-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("takeSnapshot", () => {
  it("captures file hashes", async () => {
    await writeFile(join(testDir, "hello.js"), "console.log('hello');");
    const snap = await takeSnapshot(testDir);
    expect(snap.size).toBe(1);
    expect(snap.has("hello.js")).toBe(true);
  });

  it("ignores node_modules", async () => {
    await mkdir(join(testDir, "node_modules"), { recursive: true });
    await writeFile(join(testDir, "node_modules", "dep.js"), "module");
    await writeFile(join(testDir, "app.js"), "app");
    const snap = await takeSnapshot(testDir);
    expect(snap.size).toBe(1);
    expect(snap.has("app.js")).toBe(true);
  });

  it("scans subdirectories", async () => {
    await mkdir(join(testDir, "src"), { recursive: true });
    await writeFile(join(testDir, "src", "index.js"), "export default {};");
    const snap = await takeSnapshot(testDir);
    expect(snap.has("src/index.js")).toBe(true);
  });
});

describe("generateSnapshotDiff", () => {
  it("detects new files", async () => {
    const before = new Map();
    await writeFile(join(testDir, "new.js"), "const x = 1;");
    const diff = await generateSnapshotDiff(before, null, testDir);
    expect(diff).toContain("new file");
    expect(diff).toContain("+const x = 1;");
    expect(diff).toContain("b/new.js");
  });

  it("detects modified files", async () => {
    await writeFile(join(testDir, "mod.js"), "original");
    const before = await takeSnapshot(testDir);
    await writeFile(join(testDir, "mod.js"), "modified");
    const diff = await generateSnapshotDiff(before, null, testDir);
    expect(diff).toContain("modified file");
    expect(diff).toContain("+modified");
  });

  it("detects deleted files", async () => {
    await writeFile(join(testDir, "del.js"), "to delete");
    const before = await takeSnapshot(testDir);
    await rm(join(testDir, "del.js"));
    const diff = await generateSnapshotDiff(before, null, testDir);
    expect(diff).toContain("deleted file");
    expect(diff).toContain("a/del.js");
  });

  it("returns empty for no changes", async () => {
    await writeFile(join(testDir, "same.js"), "unchanged");
    const before = await takeSnapshot(testDir);
    const diff = await generateSnapshotDiff(before, null, testDir);
    expect(diff.trim()).toBe("");
  });
});
