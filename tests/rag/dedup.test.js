// KJC-TSK-0484 — Content-hash dedup. Identical chunk bodies must skip the
// embedder call when re-encountered for the same project; different projects
// stay isolated (no cross-project dedup).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openVecStore, findChunkByHash, insertChunk } from "../../src/rag/vec-store.js";
import { indexFile } from "../../src/rag/indexer.js";

function makeEmbedder() {
  const counter = { calls: 0 };
  const embedder = {
    dim: 8,
    embed: async (text) => {
      counter.calls += 1;
      return new Array(8).fill(0).map((_, i) => ((text.length + i) % 7) / 7);
    },
  };
  return { embedder, counter };
}

describe("rag/indexer — content-hash dedup (KJC-TSK-0484)", () => {
  let tmp;
  let db;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "kj-dedup-"));
    process.env.KJ_RAG_DB = join(tmp, "rag.db");
    db = openVecStore({ dim: 8 });
  });
  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.KJ_RAG_DB;
  });

  it("findChunkByHash returns null for unseen hashes and the row for known ones", () => {
    expect(findChunkByHash(db, "deadbeef", "proj1")).toBeNull();
    insertChunk(db, {
      source: "/x.md", kind: "plan", text: "hi", metadata: null,
      embedding: new Array(8).fill(0), project: "proj1", contentHash: "deadbeef",
    });
    const hit = findChunkByHash(db, "deadbeef", "proj1");
    expect(hit).toMatchObject({ source: "/x.md" });
  });

  it("skips the embedder when an identical chunk exists for the same project", async () => {
    const { embedder, counter } = makeEmbedder();
    const a = join(tmp, "a.md");
    const b = join(tmp, "b.md");
    const body = "# Hello\n\nshared body across two files\n";
    writeFileSync(a, body);
    writeFileSync(b, body);
    const r1 = await indexFile(a, { db, embedder, project: "proj1" });
    const callsAfter1 = counter.calls;
    const r2 = await indexFile(b, { db, embedder, project: "proj1" });
    expect(r1.indexed).toBeGreaterThan(0);
    expect(r2.skipped).toBe(r1.indexed);
    expect(r2.indexed).toBe(0);
    expect(counter.calls).toBe(callsAfter1);
  });

  it("does NOT dedup across different projects (isolation wins)", async () => {
    const { embedder, counter } = makeEmbedder();
    const a = join(tmp, "a.md");
    const b = join(tmp, "b.md");
    const body = "# Header\n\nsame markdown but different repos\n";
    writeFileSync(a, body);
    writeFileSync(b, body);
    const r1 = await indexFile(a, { db, embedder, project: "proj1" });
    const r2 = await indexFile(b, { db, embedder, project: "proj2" });
    expect(r2.indexed).toBe(r1.indexed);
    expect(r2.skipped).toBe(0);
    expect(counter.calls).toBe(r1.indexed + r2.indexed);
  });
});
