// KJC-TSK-0445 — Tests for /api/rag/stats. Verifies snapshot shape against
// (a) an empty/uninitialized DB and (b) a DB seeded with chunks.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import request from "supertest";

let tmpHome, app;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "hu-board-rag-"));
  process.env.KJ_HOME = tmpHome;
  process.env.KARAJAN_HOME = tmpHome;
  process.env.KJ_RAG_DB = join(tmpHome, "rag.db");
  const { default: ragRoutes } = await import("../src/routes/rag.js");
  app = express();
  app.use("/api/rag", ragRoutes);
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.KJ_HOME; delete process.env.KARAJAN_HOME; delete process.env.KJ_RAG_DB;
});

describe("GET /api/rag/stats", () => {
  it("reports uninitialized when rag.db does not exist", async () => {
    const res = await request(app).get("/api/rag/stats");
    expect(res.status).toBe(200);
    expect(res.body.initialized).toBe(false);
    expect(res.body.embedder.provider).toBe("ollama");
  });

  it("returns chunk counts grouped by kind and project when populated", async () => {
    const { openVecStore, insertChunk } = await import("../../../src/rag/vec-store.js");
    const db = openVecStore({ dim: 4 });
    insertChunk(db, { source: "a.js", kind: "code", text: "auth", embedding: [0.1, 0.2, 0.3, 0.4], project: "proj-a" });
    insertChunk(db, { source: "b.md", kind: "plan", text: "spec", embedding: [0.5, 0.6, 0.7, 0.8], project: "proj-a" });
    insertChunk(db, { source: "c.js", kind: "code", text: "router", embedding: [0.1, 0.1, 0.1, 0.1], project: "proj-b" });
    insertChunk(db, { source: "x.js", kind: "code", text: "legacy", embedding: [0.1, 0.1, 0.1, 0.1] });
    db.close();
    const res = await request(app).get("/api/rag/stats");
    expect(res.body.initialized).toBe(true);
    expect(res.body.total_chunks).toBe(4);
    const byKind = Object.fromEntries(res.body.by_kind.map((r) => [r.kind, r.n]));
    expect(byKind).toEqual({ code: 3, plan: 1 });
    const byProj = Object.fromEntries(res.body.by_project.map((r) => [r.project, r.n]));
    expect(byProj).toEqual({ "proj-a": 2, "proj-b": 1, "(no slug)": 1 });
    expect(res.body.db_size_bytes).toBeGreaterThan(0);
  });
});
