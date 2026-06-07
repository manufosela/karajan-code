// KJC-TSK-0445 — RAG retrieval-quality dashboard route.
// GET /api/rag/stats → snapshot of the local rag.db (counts per kind/project,
// active embedder, db size, last-index timestamp). Missing DB returns an
// "uninitialized" payload so the dashboard renders an empty state cleanly.
import { Router } from "express";
import { existsSync, statSync } from "node:fs";
import Database from "better-sqlite3";
import { dbPath } from "@karajan/core/vec-store";
import { readConfig } from "../config-yaml.js";

const router = Router();
const DIMS = { ollama: 768, openai: 1536, voyage: 1024, cohere: 1024, mistral: 1024, onnx: 384 };

function embedder() {
  try {
    const e = (readConfig()?.rag?.embedder) || {};
    const provider = e.provider || "ollama";
    return { provider, model: e.model || null, dim: e.dim || DIMS[provider] || null };
  } catch { return { provider: "ollama", model: null, dim: 768 }; }
}

router.get("/stats", (_req, res) => {
  const path = dbPath();
  if (!existsSync(path)) return res.json({ ok: true, initialized: false, message: "rag.db not initialized — run `kj rag index <dir>` to start indexing.", embedder: embedder() });
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    // KJC-BUG-0068 — readonly handler cannot run the project_slug migration
    // (KJC-TSK-0438). Legacy DBs created pre-v2.27 lack the column; detect
    // and fall back so the dashboard renders instead of crashing with 500.
    const hasProjectSlug = db.prepare("PRAGMA table_info(chunks)").all().some((c) => c.name === "project_slug");
    const total_chunks = db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n;
    const by_kind = db.prepare("SELECT kind, COUNT(*) AS n FROM chunks GROUP BY kind").all();
    const by_project = hasProjectSlug
      ? db.prepare("SELECT COALESCE(project_slug, '(no slug)') AS project, COUNT(*) AS n FROM chunks GROUP BY project_slug ORDER BY n DESC LIMIT 20").all()
      : [];
    const last_indexed = db.prepare("SELECT MAX(created_at) AS ts FROM chunks").get().ts;
    db.close();
    res.json({ ok: true, initialized: true, db_path: path, db_size_bytes: statSync(path).size, total_chunks, by_kind, by_project, last_indexed, embedder: embedder(), schema_legacy: !hasProjectSlug });
  } catch (err) { res.status(500).json({ ok: false, error: String(err.message || err) }); }
});

export default router;
