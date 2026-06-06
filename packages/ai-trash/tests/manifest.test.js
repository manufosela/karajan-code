import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import {
  loadManifest,
  saveManifest,
  addEntry,
  listEntries,
  removeEntry,
  expireBefore,
  enforceLruQuota,
  SCHEMA_VERSION,
} from "../src/manifest.js";

async function tmpRoot() {
  return mkdtemp(join(tmpdir(), "ai-trash-"));
}

describe("manifest persistence", () => {
  it("returns an empty manifest when the file does not exist", async () => {
    const root = await tmpRoot();
    const m = await loadManifest(root);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.entries).toEqual([]);
  });

  it("round-trips entries via save + load", async () => {
    const root = await tmpRoot();
    const m = await loadManifest(root);
    addEntry(m, { sourcePath: "/tmp/a.txt", sizeBytes: 12, command: "rm -rf /tmp/a.txt" });
    addEntry(m, { sourcePath: "/tmp/b.txt", sizeBytes: 8 });
    await saveManifest(root, m);
    const reloaded = await loadManifest(root);
    expect(reloaded.entries).toHaveLength(2);
    expect(reloaded.entries[0].sourcePath).toBe("/tmp/a.txt");
    expect(reloaded.entries[0].command).toBe("rm -rf /tmp/a.txt");
    expect(reloaded.entries[1].origin).toBe("unknown");
  });

  it("writes the manifest with 0o600 permissions", async () => {
    const root = await tmpRoot();
    const m = await loadManifest(root);
    addEntry(m, { sourcePath: "/tmp/c.txt", sizeBytes: 1 });
    await saveManifest(root, m);
    const info = await stat(join(root, "manifest.json"));
    expect(info.mode & 0o777).toBe(0o600);
    const raw = await readFile(join(root, "manifest.json"), "utf8");
    expect(JSON.parse(raw).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("rejects invalid entries", () => {
    const m = { schemaVersion: SCHEMA_VERSION, entries: [] };
    expect(() => addEntry(m, { sizeBytes: 1 })).toThrow(/sourcePath/);
    expect(() => addEntry(m, { sourcePath: "/x", sizeBytes: -1 })).toThrow(/sizeBytes/);
  });
});

describe("listEntries / removeEntry", () => {
  it("lists by ulid and removes by id (or returns null)", () => {
    const m = { schemaVersion: SCHEMA_VERSION, entries: [] };
    const a = addEntry(m, { sourcePath: "/x/a", sizeBytes: 1 });
    const b = addEntry(m, { sourcePath: "/x/b", sizeBytes: 1 });
    expect(listEntries(m).map((e) => e.id)).toEqual([a.id, b.id]);
    expect(removeEntry(m, a.id).id).toBe(a.id);
    expect(m.entries).toHaveLength(1);
    expect(removeEntry(m, "ZZZ")).toBeNull();
  });
});

describe("expireBefore", () => {
  it("drops entries older than the cutoff", () => {
    const m = { schemaVersion: SCHEMA_VERSION, entries: [] };
    const old = addEntry(m, { sourcePath: "/x/old", sizeBytes: 1 });
    old.createdAt = 1_000;
    const fresh = addEntry(m, { sourcePath: "/x/new", sizeBytes: 1 });
    fresh.createdAt = 10_000;
    const expired = expireBefore(m, 5_000);
    expect(expired.map((e) => e.id)).toEqual([old.id]);
    expect(m.entries.map((e) => e.id)).toEqual([fresh.id]);
  });
});

describe("enforceLruQuota", () => {
  it("evicts the oldest entries until the byte budget is met", () => {
    const m = { schemaVersion: SCHEMA_VERSION, entries: [] };
    const a = addEntry(m, { sourcePath: "/x/a", sizeBytes: 100 });
    const b = addEntry(m, { sourcePath: "/x/b", sizeBytes: 100 });
    const c = addEntry(m, { sourcePath: "/x/c", sizeBytes: 100 });
    expect(enforceLruQuota(m, 150).map((e) => e.id)).toEqual([a.id, b.id]);
    expect(m.entries.map((e) => e.id)).toEqual([c.id]);
  });

  it("evicts nothing under quota and rejects negative quota", () => {
    const m = { schemaVersion: SCHEMA_VERSION, entries: [] };
    addEntry(m, { sourcePath: "/x/a", sizeBytes: 50 });
    expect(enforceLruQuota(m, 1000)).toEqual([]);
    expect(() => enforceLruQuota(m, -1)).toThrow(/maxBytes/);
  });
});
