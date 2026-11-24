// HU-4867 (KJC-TSK-1770): each RAG query leaves one metadata line in .karajan/traces/rag.jsonl.
// Never the query text, never a hit's path or content: only how many hits, how long, and whether the index was stale.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SOURCES = new Set(["cli", "mcp"]);
const STALE_REASONS = new Set(["drift-too-large", "bootstrap-failed", "bootstrapping", "bootstrap-queued", "embed-schema-old"]);
let warned = false;

export function staleFromUpdate(result) {
  if (!result) return null;
  if (result.failed || STALE_REASONS.has(result.reason)) return true;
  if (result.ran || (result.skipped && result.head && !result.reason)) return false;
  return null;
}

export function traceRagQuery(projectDir, { source, hits, latencyMs, stale }, { logger } = {}) {
  const karajanDir = join(projectDir, ".karajan");
  if (!existsSync(karajanDir)) return;
  const line = {
    at: new Date().toISOString(),
    source: SOURCES.has(source) ? source : "other",
    hits: Array.isArray(hits) ? hits.length : 0,
    latencyMs: Math.round(latencyMs),
    stale: typeof stale === "boolean" ? stale : null,
  };
  try {
    const dir = join(karajanDir, "traces");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "rag.jsonl"), `${JSON.stringify(line)}\n`);
  } catch (err) {
    if (warned) return;
    warned = true;
    logger?.warn?.(`[rag] could not write the query trace .karajan/traces/rag.jsonl: ${err.message}`);
  }
}
