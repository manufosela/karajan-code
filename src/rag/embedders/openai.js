// KJC-TSK-0442 — OpenAI text-embeddings adapter.
import { cloudEmbed } from "./_cloud-base.js";

const DEFAULTS = { url: "https://api.openai.com/v1/embeddings", model: "text-embedding-3-small", dim: 1536, timeoutMs: 30000 };

export class OpenAIEmbedderError extends Error {
  constructor(message, { cause, status } = {}) { super(message); this.name = "OpenAIEmbedderError"; if (cause) this.cause = cause; if (status != null) this.status = status; }
}

export class OpenAIEmbedder {
  constructor({ url = DEFAULTS.url, apiKey = process.env.OPENAI_API_KEY, model = process.env.KJ_OPENAI_EMBED_MODEL || DEFAULTS.model, dim = DEFAULTS.dim, timeoutMs = DEFAULTS.timeoutMs, fetchFn = globalThis.fetch } = {}) {
    if (!apiKey) throw new OpenAIEmbedderError("OpenAI embedder requires an api_key (config.rag.embedder.api_key or OPENAI_API_KEY env)");
    Object.assign(this, { url, apiKey, model, dim, timeoutMs, fetch: fetchFn });
  }
  async embed(text) { return cloudEmbed(this, text, OpenAIEmbedderError, { provider: "OpenAI", body: { model: this.model, input: text }, extract: (b) => b?.data?.[0]?.embedding }); }
  async embedBatch(texts) { if (!Array.isArray(texts)) throw new OpenAIEmbedderError("embedBatch: texts must be an array"); const out = []; for (const t of texts) out.push(await this.embed(t)); return out; }
}
