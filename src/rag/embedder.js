// KJC-PCS-0049 Step 2 — Ollama embedder adapter for the RAG pipeline.
// Talks to a local Ollama server (POST /api/embeddings) and returns
// Float32Array vectors. Cero deps externas; usa fetch global.
//
// Defaults:
//   url       = process.env.KJ_OLLAMA_URL or "http://localhost:11434"
//   model     = process.env.KJ_OLLAMA_EMBED_MODEL or "nomic-embed-text"
//   dim       = 768  (matches nomic-embed-text)
//   timeoutMs = 30000

const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "nomic-embed-text";
const DEFAULT_DIM = 768;
const DEFAULT_TIMEOUT_MS = 30000;

export class OllamaEmbedderError extends Error {
  constructor(message, { cause, status } = {}) {
    super(message);
    this.name = "OllamaEmbedderError";
    if (cause) this.cause = cause;
    if (status != null) this.status = status;
  }
}

export class OllamaEmbedder {
  constructor({
    url = process.env.KJ_OLLAMA_URL || DEFAULT_URL,
    model = process.env.KJ_OLLAMA_EMBED_MODEL || DEFAULT_MODEL,
    dim = DEFAULT_DIM,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchFn = globalThis.fetch,
  } = {}) {
    this.url = url.replace(/\/$/, "");
    this.model = model;
    this.dim = dim;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchFn;
  }

  /** Single-text embedding. Returns Float32Array(dim). */
  async embed(text) {
    if (typeof text !== "string" || text.length === 0) {
      throw new OllamaEmbedderError("embed: text must be a non-empty string");
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetch(`${this.url}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new OllamaEmbedderError(`Ollama embed request failed (${this.url}): ${err.message}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new OllamaEmbedderError(`Ollama embed HTTP ${res.status} from ${this.url}`, { status: res.status });
    }
    const body = await res.json();
    const arr = body?.embedding;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new OllamaEmbedderError("Ollama response missing 'embedding' array");
    }
    if (arr.length !== this.dim) {
      throw new OllamaEmbedderError(`Ollama dim mismatch: got ${arr.length}, expected ${this.dim} for model ${this.model}`);
    }
    return Float32Array.from(arr);
  }

  /** Batch embedding (sequential — Ollama /api/embeddings is single-text). */
  async embedBatch(texts) {
    if (!Array.isArray(texts)) throw new OllamaEmbedderError("embedBatch: texts must be an array");
    const out = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }
}
