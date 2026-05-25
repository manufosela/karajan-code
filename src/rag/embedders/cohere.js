// KJC-TSK-0446 — Cohere embed-v3 adapter. Cohere returns
// { embeddings: { float: [[...]] } } when `embedding_types: ["float"]`
// is requested, or { embeddings: [[...]] } in legacy v1. We extract the
// modern shape with a v1 fallback.
import { cloudEmbed } from "./_cloud-base.js";

const DEFAULTS = { url: "https://api.cohere.com/v2/embed", model: "embed-multilingual-v3.0", dim: 1024, timeoutMs: 30000 };

export class CohereEmbedderError extends Error {
  constructor(message, { cause, status } = {}) { super(message); this.name = "CohereEmbedderError"; if (cause) this.cause = cause; if (status != null) this.status = status; }
}

export class CohereEmbedder {
  constructor({ url = DEFAULTS.url, apiKey = process.env.KJ_COHERE_KEY, model = process.env.KJ_COHERE_EMBED_MODEL || DEFAULTS.model, dim = DEFAULTS.dim, timeoutMs = DEFAULTS.timeoutMs, fetchFn = globalThis.fetch } = {}) {
    // KJC architecture invariant: scoped env var (KJ_COHERE_KEY), not the
    // generic COHERE_API_KEY — same rule as OpenAI/Voyage adapters.
    if (!apiKey) throw new CohereEmbedderError("Cohere embedder requires an api_key (config.rag.embedder.api_key or KJ_COHERE_KEY env)");
    Object.assign(this, { url, apiKey, model, dim, timeoutMs, fetch: fetchFn });
  }
  async embed(text) {
    return cloudEmbed(this, text, CohereEmbedderError, {
      provider: "Cohere",
      body: { model: this.model, texts: [text], input_type: "search_document", embedding_types: ["float"] },
      extract: (b) => b?.embeddings?.float?.[0] || b?.embeddings?.[0],
    });
  }
  async embedBatch(texts) { if (!Array.isArray(texts)) throw new CohereEmbedderError("embedBatch: texts must be an array"); const out = []; for (const t of texts) out.push(await this.embed(t)); return out; }
}
