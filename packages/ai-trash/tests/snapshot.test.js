import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

import { snapshotFile, restoreSnapshot, purgeSnapshot } from "../src/snapshot.js";
import { readLog } from "../src/logger.js";
import { FILE_MODE } from "../src/permissions.js";

async function tmpRoot() {
  return mkdtemp(join(tmpdir(), "ai-trash-snap-"));
}

async function writeSource(content = "hello") {
  const dir = await mkdtemp(join(tmpdir(), "ai-trash-src-"));
  const file = join(dir, "note.txt");
  await writeFile(file, content);
  return file;
}

describe("snapshotFile", () => {
  it("copies source into <root>/store/<ulid>/ with 0o600 mode and logs the event", async () => {
    const root = await tmpRoot();
    const src = await writeSource("contents");
    const entry = await snapshotFile(root, src, { command: "rm note.txt", origin: "claude" });
    expect(entry.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(entry.sourcePath).toBe(src);
    expect(entry.snapshotPath).toBe(join(root, "store", entry.id, "note.txt"));
    expect(entry.sizeBytes).toBe(8);
    expect(entry.command).toBe("rm note.txt");
    expect(entry.origin).toBe("claude");
    const copy = await readFile(entry.snapshotPath, "utf8");
    expect(copy).toBe("contents");
    const info = await stat(entry.snapshotPath);
    expect(info.mode & 0o777).toBe(FILE_MODE);
    const log = await readLog(root);
    expect(log).toHaveLength(1);
    expect(log[0].event).toBe("snapshot.create");
    expect(log[0].id).toBe(entry.id);
  });

  it("rejects when the source is missing", async () => {
    const root = await tmpRoot();
    await expect(snapshotFile(root, "/no/such/file")).rejects.toThrow(/source not found/);
  });

  it("rejects directories in the MVP", async () => {
    const root = await tmpRoot();
    const dir = await mkdtemp(join(tmpdir(), "ai-trash-dir-"));
    await expect(snapshotFile(root, dir)).rejects.toThrow(/directory snapshots/);
  });
});

describe("restoreSnapshot", () => {
  it("restores to the original path and logs the event", async () => {
    const root = await tmpRoot();
    const src = await writeSource("payload");
    const entry = await snapshotFile(root, src);
    await writeFile(src, "deleted-stub"); // simulate that something else exists
    await expect(restoreSnapshot(root, entry)).rejects.toThrow(/refusing to overwrite/);
    const alt = join(dirname(src), "restored.txt");
    const written = await restoreSnapshot(root, entry, alt);
    expect(written).toBe(alt);
    expect(await readFile(alt, "utf8")).toBe("payload");
    const log = await readLog(root);
    expect(log.map((l) => l.event)).toEqual(["snapshot.create", "snapshot.restore"]);
  });
});

describe("purgeSnapshot", () => {
  it("removes the store dir and logs the purge", async () => {
    const root = await tmpRoot();
    const src = await writeSource("bye");
    const entry = await snapshotFile(root, src);
    await purgeSnapshot(root, entry);
    await expect(stat(entry.snapshotPath)).rejects.toThrow();
    const log = await readLog(root);
    expect(log.map((l) => l.event)).toEqual(["snapshot.create", "snapshot.purge"]);
  });
});
