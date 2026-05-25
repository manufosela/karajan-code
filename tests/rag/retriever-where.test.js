// KJC-TSK-0448 — integration: retriever honours --where filter end-to-end.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openVecStore, insertChunk } from "../../src/rag/vec-store.js";
import { query } from "../../src/rag/retriever.js";

let tmp, db;

const stubEmbedder = {
  embed: async (_text) => Float32Array.from([0.5, 0.5, 0.5, 0.5]),
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kj-where-"));
  process.env.KJ_RAG_DB = join(tmp, "rag.db");
  db = openVecStore({ dim: 4 });
  insertChunk(db, { source: "src/auth.js", kind: "code", text: "loadConfig user login", metadata: { symbol: "loadConfig", file: "auth.js" }, embedding: [0.1, 0.2, 0.3, 0.4], project: "myapp" });
  insertChunk(db, { source: "src/router.js", kind: "code", text: "router config setup", metadata: { symbol: "createRouter", file: "router.js" }, embedding: [0.5, 0.5, 0.5, 0.5], project: "myapp" });
  insertChunk(db, { source: "plans/p1.md", kind: "plan", text: "loadConfig validation hu plan", metadata: { hu_id: "HU-003" }, embedding: [0.9, 0.9, 0.9, 0.9], project: "myapp" });
});

afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); delete process.env.KJ_RAG_DB; });

describe("retriever query() honours --where", () => {
  it("with no where, returns all matching chunks", async () => {
    const hits = await query(db, stubEmbedder, "loadConfig", { topK: 10, project: "myapp" });
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by symbol", async () => {
    const hits = await query(db, stubEmbedder, "loadConfig", { topK: 10, project: "myapp", where: "symbol=loadConfig" });
    expect(hits.length).toBe(1);
    expect(hits[0].metadata.symbol).toBe("loadConfig");
  });

  it("filters by hu_id", async () => {
    const hits = await query(db, stubEmbedder, "loadConfig", { topK: 10, project: "myapp", where: "hu_id=HU-003" });
    expect(hits.length).toBe(1);
    expect(hits[0].kind).toBe("plan");
  });

  it("combines clauses with AND", async () => {
    const hits = await query(db, stubEmbedder, "router", { topK: 10, project: "myapp", where: "kind=code AND symbol=createRouter" });
    expect(hits.length).toBe(1);
    expect(hits[0].metadata.symbol).toBe("createRouter");
  });

  it("returns empty when filter matches nothing", async () => {
    const hits = await query(db, stubEmbedder, "loadConfig", { topK: 10, project: "myapp", where: "symbol=doesNotExist" });
    expect(hits).toEqual([]);
  });

  it("throws on malformed where", async () => {
    await expect(query(db, stubEmbedder, "x", { project: "myapp", where: "no-equals" })).rejects.toThrow(/bad pair/);
  });
});
