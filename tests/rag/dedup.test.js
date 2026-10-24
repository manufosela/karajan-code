// KJC-TSK-0484 — Content-hash dedup. A chunk the embedder already read (same body under
// the same header: path, symbol, lines) skips the embedder call for the same project;
// different projects stay isolated (no cross-project dedup). KJC-TSK-1171 (RAG-B): the
// header is part of what is embedded, so the same body in another file is another vector.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openVecStore, findChunkByHash, getEmbeddingsByIds, insertChunk } from "../../src/rag/vec-store.js";
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

  it("the same body in another file is embedded again: its header names another path", async () => {
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
    expect(r2).toMatchObject({ indexed: r1.indexed, skipped: 0 });
    expect(counter.calls).toBe(callsAfter1 * 2);
  });

  // KJC-BUG-0281 (#1980): a dedup'd chunk still belongs to its new source. A
  // CLAUDE.md identical to the AGENTS.md kj harden writes ended with ZERO rows,
  // so the coverage check reported it missing after every reindex, forever.
  it("writes the rows of a fully duplicated file under its own source, with a vector of its own", async () => {
    const { embedder } = makeEmbedder();
    const a = join(tmp, "AGENTS.md");
    const b = join(tmp, "CLAUDE.md");
    const body = "# Karajan method\n\nYou are the orchestrator; Karajan governs.\n";
    writeFileSync(a, body);
    writeFileSync(b, body);
    const r1 = await indexFile(a, { db, embedder, project: "proj1" });
    await indexFile(b, { db, embedder, project: "proj1" });
    const bySource = (s) => db.prepare("SELECT id FROM chunks WHERE source = ? AND project_slug = 'proj1'").all(s);
    expect(bySource(b)).toHaveLength(r1.indexed);
    const [idA] = bySource(a).map((r) => r.id), [idB] = bySource(b).map((r) => r.id);
    const vectors = getEmbeddingsByIds(db, [idA, idB]);
    expect(vectors.get(idB)).toBeDefined();
    expect(vectors.get(idA)).toBeDefined();
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
