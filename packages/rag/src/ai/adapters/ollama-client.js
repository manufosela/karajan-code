// @ts-check
/**
 * Factory Ollama bidireccional (roadmap 0.6.0, KJR-TSK-0124).
 *
 * Una sola configuración (baseUrl compartido) produce las tres piezas
 * contra el mismo proceso Ollama:
 *   - adapter     → generación blocking vía POST /api/generate (sin CLI)
 *   - streamAdapter → generación token a token (NDJSON, pieza existente)
 *   - embedder    → embeddings vía la API OpenAI-compatible (pieza existente)
 *
 * Ideal para RAG 100% local: mismo endpoint para embeber e inferir.
 */
import { createOllamaStreamAdapter } from './ollama-stream-adapter.js';
import { createOllamaEmbedder } from '../../embedding/openai-compatible-embedder.js';

/**
 * @typedef {import('../types.js').AdapterResult} AdapterResult
 *
 * @typedef {Object} OllamaClientOptions
 * @property {string} [baseUrl] Default 'http://localhost:11434'.
 * @property {string} [model] Modelo de generación. Default 'llama3'.
 * @property {string} [embedModel] Modelo de embeddings. Default 'nomic-embed-text'.
 * @property {number} [dimensions] Dimensión de los embeddings. Default 768.
 * @property {number} [maxTokens] num_predict para generación. Sin default (usa el del modelo).
 * @property {typeof fetch} [fetchImpl] Inyectable para tests.
 *
 * @typedef {Object} OllamaClient
 * @property {(prompt: string) => Promise<AdapterResult>} adapter Generación blocking HTTP.
 * @property {(prompt: string) => AsyncIterable<string>} streamAdapter Generación en streaming NDJSON.
 * @property {import('../../embedding/embedder.js').Embedder} embedder Embeddings del mismo proceso.
 * @property {string} baseUrl Config compartida efectiva.
 */

/**
 * Crea el cliente Ollama con las tres piezas coherentes.
 *
 * @param {OllamaClientOptions} [options]
 * @returns {OllamaClient}
 */
export function createOllamaClient(options = {}) {
  const baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
  const model = options.model ?? 'llama3';
  const embedModel = options.embedModel ?? 'nomic-embed-text';
  const dimensions = options.dimensions ?? 768;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('createOllamaClient: fetch no disponible.');
  }

  /** @type {OllamaClient['adapter']} */
  const adapter = async (prompt) => {
    const response = await fetchImpl(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        ...(options.maxTokens ? { options: { num_predict: options.maxTokens } } : {}),
      }),
    });
    const stdout = await response.text().catch(() => '');
    if (!response.ok) {
      return {
        provider: 'ollama-http',
        process: {
          stdout,
          stderr: `HTTP ${response.status} ${response.statusText}`,
          exitCode: 1,
          signal: null,
          timedOut: false,
        },
        parsedOutput: { format: 'text', json: null, text: stdout },
        providerMeta: { model, baseUrl },
      };
    }
    /** @type {any} */
    let json;
    try {
      json = JSON.parse(stdout);
    } catch {
      json = null;
    }
    const content = typeof json?.response === 'string' ? json.response : stdout;
    return {
      provider: 'ollama-http',
      process: { stdout, stderr: '', exitCode: 0, signal: null, timedOut: false },
      parsedOutput: { format: 'json', json: { answer: content, raw: json }, text: content },
      providerMeta: {
        model,
        baseUrl,
        evalCount: json?.eval_count ?? null,
        totalDuration: json?.total_duration ?? null,
      },
    };
  };

  return {
    adapter,
    streamAdapter: createOllamaStreamAdapter({ baseUrl, model, fetchImpl }),
    embedder: createOllamaEmbedder({ baseUrl, model: embedModel, dimensions, fetchImpl }),
    baseUrl,
  };
}
