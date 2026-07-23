/**
 * ONNX embedder fallback (KJC-TSK-0683) — limited machines where installing
 * Ollama/Docker is not viable still get a working RAG: the built-in ONNX
 * embedder (all-MiniLM via @huggingface/transformers, in-process, CPU).
 * The choice is PERSISTED in the project config: onnx (384) and ollama
 * (768) have different vector dims, so the election must be sticky —
 * an index can never be written by one and queried by the other.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { getProjectConfigPath } from "../config/loader.js";

const ONNX_EMBEDDER = { provider: "onnx", dim: 384 };

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
