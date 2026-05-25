// KJC-TSK-0449 — Cross-encoder rerank stage. Re-scores the top-N hits
// from the hybrid retriever using a (query, passage) cross-encoder.
//
// Cross-encoders are slower than the bi-encoder embedders (they jointly
// encode query + passage instead of caching the passage), but they are
// substantially more precise for the final top-K ranking. Karajan calls
// the reranker only on the post-fusion candidates (≤topK*2), so the
// added latency is bounded.
//
// Model is loaded dynamically via @huggingface/transformers (same dep as
// the ONNX embedder, KJC-TSK-0447). Default: `Xenova/ms-marco-MiniLM-L-6-v2`,
// the de-facto standard sentence-transformers reranker.

const DEFAULT_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";

export class RerankError extends Error {
  constructor(message, { cause } = {}) { super(message); this.name = "RerankError"; if (cause) this.cause = cause; }
}

async function loadTransformers() {
  /* eslint-disable import-x/no-unresolved */
  try { return await import("@huggingface/transformers"); }
  catch (e1) {
    try { return await import("@xenova/transformers"); }
    catch (e2) {
      throw new RerankError(
        "rerank requires @huggingface/transformers (or legacy @xenova/transformers). Install with `npm install @huggingface/transformers`.",
        { cause: e2 },
      );
    }
  }
  /* eslint-enable import-x/no-unresolved */
}

/**
 * Lazy singleton — first call downloads weights (~80 MB), every subsequent
 * call reuses the same pipeline instance.
 */
let _pipelinePromise = null;
function getPipeline(modelName) {
  if (!_pipelinePromise) _pipelinePromise = (async () => {
    const t = await loadTransformers();
    // text-classification pipeline returns the cross-encoder relevance score
    // for a `[query, passage]` text pair when applied to a CE model.
    return t.pipeline("text-classification", modelName);
  })();
  return _pipelinePromise;
}

/** Reset for tests. */
export function _resetPipeline() { _pipelinePromise = null; }

/**
 * Rerank `hits` against `queryText` using the cross-encoder. Returns a NEW
 * array sorted by descending rerank score (best first), `score` mutated
 * so the existing downstream code (kindBoost, slicing) keeps working.
 *
 * Each input hit is treated as a [query, hit.text] pair. Truncates the
 * passage to `maxChars` to avoid blowing past the CE model's context
 * window — most CE models handle 512 tokens, ~2000 chars is safe.
 *
 * If `pipelineFn` is injected (tests), it bypasses model loading.
 */
export async function rerank(queryText, hits, { model = process.env.KJ_RERANK_MODEL || DEFAULT_MODEL, maxChars = 2000, pipelineFn = null } = {}) {
  if (!queryText || typeof queryText !== "string") throw new RerankError("rerank: queryText must be a non-empty string");
  if (!Array.isArray(hits)) throw new RerankError("rerank: hits must be an array");
  if (hits.length === 0) return hits;
  const pipe = pipelineFn || await getPipeline(model);
  const pairs = hits.map((h) => ({ text: queryText, text_pair: String(h.text || "").slice(0, maxChars) }));
  const results = await pipe(pairs);
  return hits
    .map((h, i) => ({ ...h, _rerank: Number(results[i]?.score) || 0, score: -Number(results[i]?.score) || 0 }))
    .sort((a, b) => a.score - b.score);
}
