// KJC-PCS-0049 Step 8 — POST /api/rag/query endpoint acceptance pins.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import request from "supertest";

// KJC-TSK-0632: the embedder lives in karajan-core/rag — mock the REAL
// module. The old src/rag paths are re-export shims the endpoint's
// factory (inside core) bypasses; mocking them let the test silently
// hit a live local Ollama and 500 on CI runners without one.
vi.mock("karajan-core/rag/embedder", () => {
  class FakeEmbedder {
    constructor() { this.dim = 768; }
    async embed() { const v = new Float32Array(768); v[0] = 1; return v; }
    async embedBatch(ts) { return ts.map(() => { const v = new Float32Array(768); v[0] = 1; return v; }); }
  }
  return { OllamaEmbedder: FakeEmbedder, OllamaEmbedderError: class extends Error {} };
});

let tmp, app;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "hu-board-rag-api-"));
  process.env.KJ_HOME = tmp;
  process.env.KJ_RAG_DB = join(tmp, "rag.db");
  const dbMod = await import("../src/db.js");
  dbMod.initDb();
  const { default: apiRoutes } = await import("../src/routes/api.js");
  app = express();
  app.use(express.json());
  app.use("/api", apiRoutes);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.KJ_HOME;
  delete process.env.KJ_RAG_DB;
});

describe("POST /api/rag/query — KJC-PCS-0049 Step 8", () => {
  it("rejects empty text with 400", async () => {
    const res = await request(app).post("/api/rag/query").send({ text: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
  });

  it("responds with empty=true on a fresh store", async () => {
    const res = await request(app).post("/api/rag/query").send({ text: "anything" });
    expect(res.status).toBe(200);
    expect(res.body.empty).toBe(true);
    expect(res.body.hits).toEqual([]);
    expect(res.body.topK).toBe(5);
    expect(res.body.scope).toBe("all");
  });

  it("returns hits after seeding the vec store directly", async () => {
    const { openVecStore, insertChunk } = await import("../../../src/rag/vec-store.js");
    const db = openVecStore({ dim: 768 });
    const vec = new Float32Array(768); vec[0] = 1;
    insertChunk(db, { source: "/p", kind: "plan", text: "alpha auth", embedding: vec });
    db.close();
    const res = await request(app).post("/api/rag/query").send({ text: "auth", topK: 3 });
    expect(res.status).toBe(200);
    expect(res.body.empty).toBe(false);
    expect(res.body.hits.length).toBeGreaterThan(0);
  });
});
