/**
 * ONNX embedder fallback (KJC-TSK-0683) — limited machines where installing
 * Ollama/Docker is not viable still get a working RAG: the built-in ONNX
 * embedder (all-MiniLM via @huggingface/transformers, in-process, CPU).
 * The choice is PERSISTED in the project config: onnx (384) and ollama
 * (768) have different vector dims, so the election must be sticky —
 * an index can never be written by one and queried by the other.
 */
import fs from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { parseDocument } from "yaml";
import { getProjectConfigPath } from "../config/loader.js";
import { dbPath } from "./vec-store.js";

const ONNX_EMBEDDER = { provider: "onnx", dim: 384 };

/**
 * KJC-BUG-0128: the hasRagIndex probe could leave behind an EMPTY store
 * whose vec table was created at the default dim (768) — ONNX inserts (384)
 * then failed on every chunk. Before the fallback indexes, delete an empty
 * store (plus WAL siblings) so it is recreated at the right dim. A store
 * that already HAS chunks is never touched — switching dims there would
 * destroy other projects' indexes.
 */
export function resetEmptyStore() {
  const storePath = dbPath();
  if (!existsSync(storePath)) return true;
  // Read-only, schema-agnostic inspection: no DDL, no vec extension, no
  // dimension assumptions — the store is only ever OPENED to be counted.
  const db = new Database(storePath, { readonly: true });
  try {
    const hasChunksTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'").get();
    if (hasChunksTable && db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n > 0) return false;
  } finally {
    db.close();
  }
  for (const suffix of ["", "-wal", "-shm"]) rmSync(storePath + suffix, { force: true });
  return true;
}

/** The same config, with the embedder swapped to the built-in ONNX. */
export function onnxConfig(config) {
  return {
    ...config,
    rag: { ...(config?.rag || {}), embedder: { ...(config?.rag?.embedder || {}), ...ONNX_EMBEDDER } },
  };
}

/**
 * Persist the ONNX election in the PROJECT config file. Surgical edit via
 * the yaml Document API: only rag.embedder.{provider,dim} change — the
 * user's comments, ordering and every other key survive untouched.
 */
export async function persistOnnxChoice(projectDir) {
  const configPath = getProjectConfigPath(projectDir);
  let source = "";
  try {
    source = await fs.readFile(configPath, "utf8");
  } catch { /* no project config yet — create it */ }
  const doc = parseDocument(source || "{}");
  for (const [key, value] of Object.entries(ONNX_EMBEDDER)) {
    doc.setIn(["rag", "embedder", key], value);
  }
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, doc.toString(), "utf8");
  return configPath;
}
