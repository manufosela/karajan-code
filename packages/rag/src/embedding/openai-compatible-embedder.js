// @ts-check

/**
 * @typedef {import('./embedder.js').Embedder} Embedder
 */

/**
 * @typedef {Object} OpenAICompatibleEmbedderOptions
 * @property {string} baseUrl Raíz del servidor (p. ej. "http://localhost:11434" para Ollama).
 * @property {string} model Nombre del modelo de embeddings.
 * @property {number} dimensions Dimensión esperada del vector (se valida al recibir respuesta).
 * @property {string} [apiKey] Opcional; si se pasa, se envía como Authorization: Bearer.
 * @property {string} [path] Endpoint relativo; defaults "/v1/embeddings".
 * @property {typeof fetch} [fetchImpl] Inyección para tests. Defaults a globalThis.fetch.
 */

/**
 * Crea un Embedder que habla con cualquier servidor OpenAI-compatible para
 * embeddings (OpenAI, Ollama en modo /v1, LM Studio, vLLM, LocalAI…).
 *
 * Request: POST {baseUrl}{path} con { model, input } y header opcional Authorization.
 * Response esperada: { data: [{ embedding: number[] }] } (formato OpenAI).
 *
 * @param {OpenAICompatibleEmbedderOptions} options
 * @returns {Embedder}
 */
export function createOpenAICompatibleEmbedder(options) {
  if (!options || typeof options.baseUrl !== 'string' || options.baseUrl.length === 0) {
    throw new Error('createOpenAICompatibleEmbedder: "baseUrl" requerido.');
  }
  if (typeof options.model !== 'string' || options.model.length === 0) {
    throw new Error('createOpenAICompatibleEmbedder: "model" requerido.');
  }
  if (!Number.isInteger(options.dimensions) || options.dimensions <= 0) {
    throw new Error('createOpenAICompatibleEmbedder: "dimensions" debe ser entero positivo.');
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const path = options.path ?? '/v1/embeddings';
  const model = options.model;
  const dimensions = options.dimensions;
  const apiKey = options.apiKey;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'createOpenAICompatibleEmbedder: fetch no disponible. En Node <18, pasa fetchImpl.',
    );
  }

  /**
   * @param {string[]} inputs
   * @returns {Promise<number[][]>}
   */
  async function callEmbeddings(inputs) {
    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const body = JSON.stringify({
      model,
      input: inputs.length === 1 ? inputs[0] : inputs,
    });

    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `OpenAICompatibleEmbedder: HTTP ${response.status} ${response.statusText} — ${errText}`,
      );
    }

    /** @type {any} */
    const json = await response.json();
    if (!json || !Array.isArray(json.data)) {
      throw new Error('OpenAICompatibleEmbedder: respuesta sin "data" array.');
    }
    /** @type {number[][]} */
    const vectors = json.data.map((d, i) => {
      if (!d || !Array.isArray(d.embedding)) {
        throw new Error(`OpenAICompatibleEmbedder: data[${i}].embedding no es array.`);
      }
      if (d.embedding.length !== dimensions) {
        throw new Error(
          `OpenAICompatibleEmbedder: data[${i}].embedding dimensión ${d.embedding.length} != esperada ${dimensions}.`,
        );
      }
      return d.embedding;
    });
    return vectors;
  }

  return {
    dimensions,
    async embed(text) {
      const [vector] = await callEmbeddings([String(text ?? '')]);
      return vector;
    },
    async embedBatch(texts) {
      if (!Array.isArray(texts) || texts.length === 0) return [];
      return callEmbeddings(texts.map((t) => String(t ?? '')));
    },
  };
}

/**
 * Preset para Ollama local. Asume baseUrl http://localhost:11434 y el endpoint
 * /v1/embeddings (Ollama expone ambos: /api/embeddings y /v1/embeddings; este
 * usa el compatible OpenAI para consistencia).
 *
 * @param {{ model?: string, dimensions?: number, baseUrl?: string, apiKey?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {Embedder}
 */
export function createOllamaEmbedder(options = {}) {
  return createOpenAICompatibleEmbedder({
    baseUrl: options.baseUrl ?? 'http://localhost:11434',
    model: options.model ?? 'nomic-embed-text',
    dimensions: options.dimensions ?? 768,
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
  });
}
