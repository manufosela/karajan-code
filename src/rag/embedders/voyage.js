// KJC-TSK-0442 — Voyage AI embeddings adapter.
import { cloudEmbed } from "./_cloud-base.js";

const DEFAULTS = { url: "https://api.voyageai.com/v1/embeddings", model: "voyage-code-3", dim: 1024, timeoutMs: 30000 };

export class VoyageEmbedderError extends Error {
  constructor(message, { cause, status } = {}) { super(message); this.name = "VoyageEmbedderError"; if (cause) this.cause = cause; if (status != null) this.status = status; }
}

export class VoyageEmbedder {
  constructor({ url = DEFAULTS.url, apiKey = process.env.VOYAGE_API_KEY, model = process.env.KJ_VOYAGE_EMBED_MODEL || DEFAULTS.model, dim = DEFAULTS.dim, timeoutMs = DEFAULTS.timeoutMs, fetchFn = globalThis.fetch } = {}) {
    if (!apiKey) throw new VoyageEmbedderError("Voyage embedder requires an api_key (config.rag.embedder.api_key or VOYAGE_API_KEY env)");
    Object.assign(this, { url, apiKey, model, dim, timeoutMs, fetch: fetchFn });
  }
  async embed(text) { return cloudEmbed(this, text, VoyageEmbedderError, { provider: "Voyage", body: { model: this.model, input: [text], input_type: "document" }, extract: (b) => b?.data?.[0]?.embedding }); }
  async embedBatch(texts) { if (!Array.isArray(texts)) throw new VoyageEmbedderError("embedBatch: texts must be an array"); const out = []; for (const t of texts) out.push(await this.embed(t)); return out; }
}
