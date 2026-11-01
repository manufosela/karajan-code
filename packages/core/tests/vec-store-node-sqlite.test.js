import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// KJC-TSK-0616 (SQL-B): rag.db runs on the node:sqlite adapter with sqlite-vec loaded as an
// extension. Loading better-sqlite3 at all is a failure.
vi.mock("better-sqlite3", () => {
  throw new Error("better-sqlite3 must not be loaded by the vec-store");
});

describe("vec-store on node:sqlite", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-vec-sqlite-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("indexes and finds a chunk by vector with sqlite-vec loaded", async () => {
    const { openVecStore, insertChunk, searchSimilar, countChunks } = await import("../src/vec-store.js");
    const db = openVecStore({ dim: 4, path: path.join(tmpDir, "rag.db") });
    try {
      insertChunk(db, { source: "a.js", kind: "code", text: "alpha", embedding: [1, 0, 0, 0] });
      insertChunk(db, { source: "b.js", kind: "code", text: "beta", embedding: [0, 1, 0, 0] });
      expect(countChunks(db)).toBe(2);
      const hits = searchSimilar(db, [0.9, 0.1, 0, 0], 1);
      expect(hits[0].source).toBe("a.js");
    } finally {
      db.close();
    }
  });
});
