// KJC-PCS-0049 Camino C — pre-loop RAG retrieval stage.
// Runs between triage and domainCurator. When `config.rag.preload.enabled`
// is true and the corpus has chunks, queries the retriever with the
// task text and returns a markdown block ready to prepend to the task.
// Failures degrade gracefully (warn + continue); the rest of the pipeline
// never sees an exception from this stage.
import { emitProgress, makeEvent } from "../../utils/events.js";
import { openVecStore, countChunks } from "../../rag/vec-store.js";
import { makeGovernedEmbedder } from "../../rag/governed-embedder.js";
import { query } from "../../rag/retriever.js";

const DEFAULT_TOP_K = 5;
const DEFAULT_SCOPE = "all";
const DEFAULT_SEARCH_MODE = "hybrid";
const DEFAULT_SEARCH_ALPHA = 0.6;
const MAX_CHUNK_CHARS = 600;

// KJC-TSK-0463 — pull search-time knobs from config so the HU Board
// modal (rag.search.{mode,alpha,rerank}) actually steers retrieval at
// pipeline time. Returns the args object query() expects; unset fields
// fall back to the retriever's own defaults.
export function resolveSearchOpts(config) {
  const s = config?.rag?.search ?? {};
  const out = {
    mode: typeof s.mode === "string" ? s.mode : DEFAULT_SEARCH_MODE,
    alpha: Number.isFinite(s.alpha) ? s.alpha : DEFAULT_SEARCH_ALPHA,
  };
  if (s.rerank && typeof s.rerank === "object") out.rerankOpts = s.rerank;
  else if (s.rerank === true) out.rerankOpts = {};
  return out;
}

/**
 * Runs the RAG preload stage. Returns:
 *   { skipped: true, reason }                  — when disabled / empty / error
 *   { skipped: false, contextBlock, hits }     — markdown block + raw hits
 *
 * The caller decides whether to mutate `task` with the contextBlock. We
 * keep that responsibility at the call site so this module stays pure.
 */
export async function runRagContextStage({ config, logger, emitter, eventBase, task }) {
  const preload = config?.rag?.preload;
  if (!preload?.enabled) return { skipped: true, reason: "disabled" };
  if (typeof task !== "string" || task.length === 0) return { skipped: true, reason: "no-task" };
  try {
    const dim = config?.rag?.embedder?.dim || 768;
    const db = openVecStore({ dim });
    try {
      if (countChunks(db) === 0) {
        logger?.info?.("[rag-preload] corpus is empty, skipping (run `kj rag index` to seed)");
        return { skipped: true, reason: "empty" };
      }
      const topK = preload.topK || DEFAULT_TOP_K;
      const scope = preload.scope || DEFAULT_SCOPE;
      const embedder = makeGovernedEmbedder(config);
      const searchOpts = resolveSearchOpts(config);
      const hits = await query(db, embedder, task, { topK, scope, ...searchOpts });
      if (hits.length === 0) return { skipped: true, reason: "no-hits" };
      const lines = hits.map((h) => {
        const label = h.metadata?.hu_id || h.metadata?.symbol || h.metadata?.headingPath?.join(" > ") || "block";
        const text = h.text.length > MAX_CHUNK_CHARS ? `${h.text.slice(0, MAX_CHUNK_CHARS)}…` : h.text;
        return `### [${h.kind} · ${label}] ${h.source}\n\n${text}`;
      });
      const contextBlock = `## Prior context from RAG (auto-retrieved, top ${hits.length})\n\n${lines.join("\n\n")}`;
      emitProgress(emitter, makeEvent("rag-preload:hits", { ...eventBase, stage: "rag-preload" }, {
        message: `RAG preload: injected ${hits.length} chunk(s) into the task context`,
        detail: { topK, scope, hits: hits.length, mode: searchOpts.mode, alpha: searchOpts.alpha, rerank: Boolean(searchOpts.rerankOpts) },
      }));
      return { skipped: false, contextBlock, hits };
    } finally {
      db.close();
    }
  } catch (err) {
    logger?.warn?.(`[rag-preload] failed (non-blocking): ${err.message}`);
    return { skipped: true, reason: "error", error: err.message };
  }
}
