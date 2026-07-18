// KJC-TSK-0447 — ONNX local embedder via @huggingface/transformers
// (formerly @xenova/transformers). Runs sentence-transformer models
// directly in Node — no API key, no Docker, no Ollama.
//
// First call downloads the model weights to ~/.cache/huggingface/ (~80 MB
// for the default MiniLM). Subsequent calls reuse the cache, so the steady
// state is fully offline.
//
// Default model: `Xenova/all-MiniLM-L6-v2` (384 dim, ~80 MB, fast).
// Higher-quality alternative: `Xenova/jina-embeddings-v2-base-en`
// (768 dim, ~260 MB, slower but better for retrieval).

const DEFAULTS = { model: "Xenova/all-MiniLM-L6-v2", dim: 384, pooling: "mean", normalize: true };

export class ONNXEmbedderError extends Error {
  constructor(message, { cause } = {}) { super(message); this.name = "ONNXEmbedderError"; if (cause) this.cause = cause; }
}

async function loadTransformers() {
  // Prefer the modern @huggingface/transformers (post-2024 rebrand);
  // fall back to @xenova/transformers for users still on the legacy package.
  // Both are optional peer deps — Karajan does not ship them by default to
  // keep the install size small (~500 MB with WASM + weights). The user
  // installs whichever they prefer when they opt into provider: onnx.
  /* eslint-disable import-x/no-unresolved */
  try { return await import("@huggingface/transformers"); }
  catch (e1) {
    try { return await import("@xenova/transformers"); }
    catch (e2) {
      throw new ONNXEmbedderError(
        "ONNX embedder requires @huggingface/transformers (or legacy @xenova/transformers). Install with `npm install @huggingface/transformers`.",
        { cause: e2 },
      );
    }
  }
  /* eslint-enable import-x/no-unresolved */
}

export class ONNXEmbedder {
  constructor({ model = process.env.KJ_ONNX_EMBED_MODEL || DEFAULTS.model, dim = DEFAULTS.dim, pooling = DEFAULTS.pooling, normalize = DEFAULTS.normalize } = {}) {
    Object.assign(this, { model, dim, pooling, normalize, _pipe: null });
  }
  async _ensurePipeline() {
    if (this._pipe) return this._pipe;
    const transformers = await loadTransformers();
    this._pipe = await transformers.pipeline("feature-extraction", this.model);
    return this._pipe;
  }
  async embed(text) {
    if (typeof text !== "string" || text.length === 0) throw new ONNXEmbedderError("embed: text must be a non-empty string");
    const pipe = await this._ensurePipeline();
    const out = await pipe(text, { pooling: this.pooling, normalize: this.normalize });
    const arr = Array.from(out.data || []);
    if (arr.length !== this.dim) throw new ONNXEmbedderError(`ONNX dim mismatch: got ${arr.length}, expected ${this.dim} for model ${this.model}`);
    return Float32Array.from(arr);
  }
  async embedBatch(texts) {
    if (!Array.isArray(texts)) throw new ONNXEmbedderError("embedBatch: texts must be an array");
    const out = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }
}
