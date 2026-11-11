/**
 * KJC-BUG-0486 (#3308): what the last `kj rag query` answered, for the Sentinel. Its rag-first
 * ledger read the hits from the command's visible output, so a filtered one (| tail -2) counted
 * as no answer. The PostToolUse hook reads this note for the same query, freshly written.
 * Only in a kj project (a .karajan folder): elsewhere nothing governs, and nothing is written.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function noteRagAnswer({ projectDir, text, hits, now = Date.now() }) {
  if (!existsSync(join(projectDir, ".karajan"))) return;
  const dir = join(projectDir, ".karajan", "harness");
  mkdirSync(dir, { recursive: true });
  const sources = [...new Set(hits.map((h) => h?.source).filter((s) => typeof s === "string"))];
  writeFileSync(join(dir, "rag-answer.json"), `${JSON.stringify({ at: now, text, sources })}\n`);
}

/**
 * KJC-TSK-1521: that a reindex starts or ends here (`phase`), for kj stage, which shows
 * kaRAGan at it meanwhile. Same rule: only in a kj project.
 */
export function noteRagIndex({ projectDir, phase, now = Date.now() }) {
  if (!existsSync(join(projectDir, ".karajan"))) return;
  const dir = join(projectDir, ".karajan", "harness");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "rag-index.json"), `${JSON.stringify({ at: now, phase })}\n`);
}
