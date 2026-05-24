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
    insertChunk(db, { source: "/c1", kind: "code", text: "code", embedding: oneHot(0) });
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
});
