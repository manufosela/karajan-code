// KJC-TSK-0446 — Mistral AI embeddings adapter. EU-hosted, useful for
// users with GDPR constraints that prefer not to send chunks to US
// endpoints. Single model today (`mistral-embed`, 1024 dim).
import { cloudEmbed } from "./_cloud-base.js";

const DEFAULTS = { url: "https://api.mistral.ai/v1/embeddings", model: "mistral-embed", dim: 1024, timeoutMs: 30000 };

export class MistralEmbedderError extends Error {
  constructor(message, { cause, status } = {}) { super(message); this.name = "MistralEmbedderError"; if (cause) this.cause = cause; if (status != null) this.status = status; }
}

export class MistralEmbedder {
  constructor({ url = DEFAULTS.url, apiKey = process.env.KJ_MISTRAL_KEY, model = process.env.KJ_MISTRAL_EMBED_MODEL || DEFAULTS.model, dim = DEFAULTS.dim, timeoutMs = DEFAULTS.timeoutMs, fetchFn = globalThis.fetch } = {}) {
    // KJC architecture invariant: scoped env var (KJ_MISTRAL_KEY).
    if (!apiKey) throw new MistralEmbedderError("Mistral embedder requires an api_key (config.rag.embedder.api_key or KJ_MISTRAL_KEY env)");
    Object.assign(this, { url, apiKey, model, dim, timeoutMs, fetch: fetchFn });
  }
  async embed(text) {
    return cloudEmbed(this, text, MistralEmbedderError, {
      provider: "Mistral",
      body: { model: this.model, input: [text] },
      extract: (b) => b?.data?.[0]?.embedding,
    });
  }
  async embedBatch(texts) { if (!Array.isArray(texts)) throw new MistralEmbedderError("embedBatch: texts must be an array"); const out = []; for (const t of texts) out.push(await this.embed(t)); return out; }
}
