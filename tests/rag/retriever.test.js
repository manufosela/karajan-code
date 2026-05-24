// KJC-PCS-0049 Step 5 — retriever acceptance pins.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openVecStore, insertChunk } from "../../src/rag/vec-store.js";
import { query } from "../../src/rag/retriever.js";

function oneHot(idx, dim = 8) { const v = new Float32Array(dim); v[idx % dim] = 1; return v; }
function fakeEmbedderFor(idx) { return { embed: vi.fn(async () => oneHot(idx)), dim: 8 }; }

describe("retriever — KJC-PCS-0049 Step 5", () => {
  let root, db;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kj-rag-ret-"));
    db = openVecStore({ dim: 8, path: join(root, "rag.db") });
  });
  afterEach(() => { db?.close(); rmSync(root, { recursive: true, force: true }); });

  it("returns the topK nearest chunks ordered by score", async () => {
    insertChunk(db, { source: "/a", kind: "plan", text: "A", embedding: oneHot(0) });
    insertChunk(db, { source: "/b", kind: "plan", text: "B", embedding: oneHot(1) });
    insertChunk(db, { source: "/c", kind: "plan", text: "C", embedding: oneHot(2) });
    const hits = await query(db, fakeEmbedderFor(1), "?", { topK: 2 });
    expect(hits.length).toBe(2);
    expect(hits[0].text).toBe("B");
    expect(hits[0].score).toBeLessThanOrEqual(hits[1].score);
  });

  it("scope='plans' filters out code chunks", async () => {
    insertChunk(db, { source: "/p", kind: "plan", text: "plan-A", embedding: oneHot(0) });
    insertChunk(db, { source: "/c", kind: "code", text: "code-A", embedding: oneHot(0) });
    const hits = await query(db, fakeEmbedderFor(0), "?", { topK: 5, scope: "plans" });
    expect(hits.every((h) => h.kind === "plan")).toBe(true);
  });

  it("kind boost reorders equidistant chunks (plan > code)", async () => {
    // KJC-TSK-0440: use test-path sources so the asymmetric source boost
    // does not kick in and the original plan > onboarding > code ordering
    // still holds when the query is a single token (non-test-flavoured).
    insertChunk(db, { source: "/tests/c1.test.js", kind: "code", text: "code", embedding: oneHot(0) });
    insertChunk(db, { source: "/p1", kind: "plan", text: "plan", embedding: oneHot(0) });
    insertChunk(db, { source: "/o1", kind: "onboarding", text: "brief", embedding: oneHot(0) });
    const hits = await query(db, fakeEmbedderFor(0), "?", { topK: 3 });
    expect(hits[0].kind).toBe("plan");
    expect(hits[1].kind).toBe("onboarding");
    expect(hits[2].kind).toBe("code");
  });

  it("returns [] on an empty store", async () => {
    const hits = await query(db, fakeEmbedderFor(0), "?", { topK: 5 });
    expect(hits).toEqual([]);
  });

  it("rejects empty / non-string queries before hitting the embedder", async () => {
    const fakeE = { embed: vi.fn(async () => oneHot(0)) };
    await expect(query(db, fakeE, "", { topK: 5 })).rejects.toThrow(/non-empty string/);
    expect(fakeE.embed).not.toHaveBeenCalled();
  });

  // KJC-TSK-0440 — asymmetric source-vs-test boost
  it("ranks src/X.js above tests/X.test.js when query is NL (no test terms)", async () => {
    // Both code chunks, exact same vector → cosine distance is identical.
    // The asymmetric boost must surface the source path first.
    insertChunk(db, { source: "/repo/tests/auth.test.js", kind: "code", text: "auth test prose", embedding: oneHot(0) });
    insertChunk(db, { source: "/repo/src/auth.js", kind: "code", text: "auth impl", embedding: oneHot(0) });
    const hits = await query(db, fakeEmbedderFor(0), "how does auth work", { topK: 2 });
    expect(hits[0].source).toBe("/repo/src/auth.js");
    expect(hits[1].source).toBe("/repo/tests/auth.test.js");
  });

  it("keeps test files visible when query mentions test terms", async () => {
    insertChunk(db, { source: "/repo/tests/auth.test.js", kind: "code", text: "auth test", embedding: oneHot(0) });
    insertChunk(db, { source: "/repo/src/auth.js", kind: "code", text: "auth impl", embedding: oneHot(0) });
    const hits = await query(db, fakeEmbedderFor(0), "vitest mock for auth", { topK: 2 });
    // With test-flavoured query both keep the baseline (code: 0) → ordering is by distance only,
    // which is identical for both. We assert both appear, in any order.
    const sources = hits.map((h) => h.source);
    expect(sources).toContain("/repo/tests/auth.test.js");
    expect(sources).toContain("/repo/src/auth.js");
  });
});
