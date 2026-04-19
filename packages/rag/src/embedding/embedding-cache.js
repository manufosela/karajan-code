// @ts-check
import { createHash } from 'node:crypto';

/**
 * @typedef {import('./embedder.js').Embedder} Embedder
 */

/**
 * Contrato mínimo de un store de cache. Compatible con Map y con stores
 * custom (disco, Redis…). Implementaciones async por defecto.
 *
 * @typedef {Object} CacheStore
 * @property {(key: string) => Promise<number[] | undefined> | number[] | undefined} get
 * @property {(key: string, value: number[]) => Promise<void> | void} set
 * @property {(key: string) => Promise<boolean> | boolean} [has]
 */

/**
 * Construye la key de cache con fingerprint del embedder + sha256 del texto.
 * Incluir modelo y dimensión evita colisiones entre configuraciones
 * distintas (ver ADR-002).
 *
 * @param {string} text
 * @param {string} model
 * @param {number} dimensions
 * @returns {string}
 */
function buildKey(text, model, dimensions) {
  const hash = createHash('sha256').update(text).digest('hex');
  return `${model}|${dimensions}|${hash}`;
}

/**
 * Envuelve un Embedder con cache idempotente por (model, dimensions, sha256(text)).
 *
 * Uso:
 *   const base = createOllamaEmbedder();
 *   const cached = createCachedEmbedder(base, { store: new Map() });
 *
 * @param {Embedder & { model?: string }} baseEmbedder
 * @param {{
 *   store?: CacheStore,
 *   model?: string,
 *   stats?: { hits: number, misses: number },
 * }} [options]
 * @returns {Embedder & { stats: { hits: number, misses: number } }}
 */
export function createCachedEmbedder(baseEmbedder, options = {}) {
  if (!baseEmbedder || typeof baseEmbedder.embed !== 'function') {
    throw new Error('createCachedEmbedder: baseEmbedder.embed requerido.');
  }
  const store = options.store ?? new Map();
  const model =
    options.model ?? /** @type {any} */ (baseEmbedder).model ?? 'unknown-model';
  const dimensions = baseEmbedder.dimensions;
  const stats = options.stats ?? { hits: 0, misses: 0 };

  /**
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async function embed(text) {
    const safe = String(text ?? '');
    const key = buildKey(safe, model, dimensions);
    const cached = await store.get(key);
    if (cached) {
      stats.hits += 1;
      return cached;
    }
    stats.misses += 1;
    const vector = await baseEmbedder.embed(safe);
    await store.set(key, vector);
    return vector;
  }

  /**
   * @param {string[]} texts
   * @returns {Promise<number[][]>}
   */
  async function embedBatch(texts) {
    if (!Array.isArray(texts) || texts.length === 0) return [];
    /** @type {Array<{ index: number, text: string, key: string }>} */
    const missing = [];
    /** @type {Array<number[] | null>} */
    const results = new Array(texts.length).fill(null);

    for (let i = 0; i < texts.length; i += 1) {
      const safe = String(texts[i] ?? '');
      const key = buildKey(safe, model, dimensions);
      // eslint-disable-next-line no-await-in-loop
      const cached = await store.get(key);
      if (cached) {
        stats.hits += 1;
        results[i] = cached;
      } else {
        stats.misses += 1;
        missing.push({ index: i, text: safe, key });
      }
    }

    if (missing.length > 0) {
      const fresh = baseEmbedder.embedBatch
        ? await baseEmbedder.embedBatch(missing.map((m) => m.text))
        : await Promise.all(missing.map((m) => baseEmbedder.embed(m.text)));
      for (let i = 0; i < missing.length; i += 1) {
        results[missing[i].index] = fresh[i];
        // eslint-disable-next-line no-await-in-loop
        await store.set(missing[i].key, fresh[i]);
      }
    }

    return /** @type {number[][]} */ (results);
  }

  return {
    dimensions,
    embed,
    embedBatch,
    stats,
  };
}
