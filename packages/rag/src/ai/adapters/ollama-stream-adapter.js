// @ts-check
/**
 * StreamAdapter HTTP para Ollama on-premise.
 *
 * Ollama expone `POST /api/generate` con `stream: true` → cuerpo NDJSON
 * donde cada línea es `{ response: "...", done: false | true, ... }`.
 * Este adapter consume el stream, parsea cada línea y emite el campo
 * `response` para que `GeneratorRole.streamGenerate` pueda reenviarlo.
 *
 * Compatible con el contrato:
 *   (prompt: string) => AsyncIterable<string>
 *
 * Uso:
 *   const stream = createOllamaStreamAdapter({ baseUrl: 'http://localhost:11434', model: 'llama3' });
 *   for await (const chunk of stream('Hola')) process.stdout.write(chunk);
 */

/**
 * @typedef {Object} OllamaStreamAdapterOptions
 * @property {string} [baseUrl] Default: http://localhost:11434
 * @property {string} model Modelo Ollama (ej. "llama3", "mistral").
 * @property {typeof fetch} [fetchImpl] Inyectable para tests.
 * @property {Record<string, unknown>} [options] Opciones extra de Ollama (temperature, num_predict, etc.).
 */

/**
 * @param {OllamaStreamAdapterOptions} cfg
 * @returns {(prompt: string) => AsyncGenerator<string, void, void>}
 */
export function createOllamaStreamAdapter(cfg) {
  if (!cfg || typeof cfg.model !== 'string' || cfg.model.length === 0) {
    throw new Error('createOllamaStreamAdapter: "model" es obligatorio.');
  }
  const baseUrl = (cfg.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  const model = cfg.model;
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const extraOptions = cfg.options ?? {};

  return async function* stream(prompt) {
    if (typeof prompt !== 'string') {
      throw new Error('ollamaStreamAdapter: prompt debe ser string.');
    }
    const url = `${baseUrl}/api/generate`;
    const body = JSON.stringify({ model, prompt, stream: true, options: extraOptions });
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await safeReadText(res);
      throw new Error(`Ollama stream HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.body) {
      throw new Error('Ollama stream: response.body es null.');
    }
    for await (const line of readNdjsonLines(res.body)) {
      const parsed = safeParseJson(line);
      if (!parsed) continue;
      if (typeof parsed.response === 'string' && parsed.response.length > 0) {
        yield parsed.response;
      }
      if (parsed.done === true) break;
    }
  };
}

/**
 * Iterador async sobre líneas NDJSON leídas de un ReadableStream.
 * Tolera trozos parciales: acumula en un buffer y emite cada vez que aparece '\n'.
 *
 * @param {ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>} body
 * @returns {AsyncGenerator<string, void, void>}
 */
export async function* readNdjsonLines(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  const iter = toAsyncIterable(body);
  for await (const chunk of iter) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIdx;

    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      const trimmed = line.trim();
      if (trimmed.length > 0) yield trimmed;
    }
  }
  // Flush residual sin \n final.
  const tail = (buffer + decoder.decode()).trim();
  if (tail.length > 0) yield tail;
}

/**
 * @param {ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>} body
 * @returns {AsyncIterable<Uint8Array>}
 */
function toAsyncIterable(body) {
  // Node 20+ ReadableStream ya soporta Symbol.asyncIterator.
  if (typeof (/** @type {any} */ (body)[Symbol.asyncIterator]) === 'function') {
    return /** @type {AsyncIterable<Uint8Array>} */ (body);
  }
  // Fallback: pull con getReader().
  const reader = /** @type {ReadableStream<Uint8Array>} */ (body).getReader();
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const { value, done } = await reader.read();
          if (done) return { value: undefined, done: true };
          return { value, done: false };
        },
      };
    },
  };
}

/**
 * @param {string} line
 * @returns {Record<string, any> | null}
 */
function safeParseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * @param {{ text(): Promise<string> }} res
 * @returns {Promise<string>}
 */
async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
