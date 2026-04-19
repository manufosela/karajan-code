// @ts-check
import { createHash } from 'node:crypto';

/**
 * @typedef {import('./embedder.js').Embedder} Embedder
 */

/**
 * Contrato mínimo de un store de cache. Compatible con Map y con stores
 * custom (disco, Redis…). Implementaciones async por defecto.
 *
 * Propiedades opcionales:
 * - `size` (prop o getter): número de entradas actualmente cacheadas. Si no
 *   está definida, `stats.size` devuelve `undefined`.
 * - Si el store implementa políticas de eviction (LRU, TTL…), debe invocar
 *   `options.onEviction` cada vez que desaloja una entrada para que el
 *   contador `stats.evictions` refleje el comportamiento real.
 *
 * @typedef {Object} CacheStore
 * @property {(key: string) => Promise<number[] | undefined> | number[] | undefined} get
 * @property {(key: string, value: number[]) => Promise<void> | void} set
 * @property {(key: string) => Promise<boolean> | boolean} [has]
 * @property {number} [size]
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
 * @typedef {Object} CachedEmbedderStats
 * @property {number} hits
 * @property {number} misses
 * @property {number} evictions
 * @property {number|undefined} size - entradas cacheadas ahora mismo (si el store lo expone).
 */

/**
 * Envuelve un Embedder con cache idempotente por (model, dimensions, sha256(text)).
 *
 * Uso:
 *   const base = createOllamaEmbedder();
 *   const cached = createCachedEmbedder(base, { store: new Map() });
 *   console.log(cached.stats); // { hits, misses, evictions, size }
 *
 * `stats.size` se calcula dinámicamente desde el store si éste expone `.size`
 * (como hace `Map`). Stores personalizados pueden incrementar
 * `stats.evictions` invocando `options.onEviction?.()` cuando descarten
 * entradas por política (LRU/TTL).
 *
 * @param {Embedder & { model?: string }} baseEmbedder
 * @param {{
 *   store?: CacheStore,
 *   model?: string,
 *   stats?: { hits: number, misses: number, evictions?: number },
 * }} [options]
 * @returns {Embedder & { stats: CachedEmbedderStats, onEviction: () => void }}
 */
export function createCachedEmbedder(baseEmbedder, options = {}) {
  if (!baseEmbedder || typeof baseEmbedder.embed !== 'function') {
    throw new Error('createCachedEmbedder: baseEmbedder.embed requerido.');
  }
  const store = options.store ?? new Map();
  const model =
    options.model ?? /** @type {any} */ (baseEmbedder).model ?? 'unknown-model';
  const dimensions = baseEmbedder.dimensions;
  const baseStats = options.stats ?? { hits: 0, misses: 0 };
  const counters = {
    hits: baseStats.hits ?? 0,
    misses: baseStats.misses ?? 0,
    evictions: baseStats.evictions ?? 0,
  };
  const stats = Object.defineProperties(counters, {
    size: {
      enumerable: true,
      get() {
        const raw = /** @type {any} */ (store).size;
        return typeof raw === 'number' ? raw : undefined;
      },
    },
  });

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
         
        await store.set(missing[i].key, fresh[i]);
      }
    }

    return /** @type {number[][]} */ (results);
  }

  function onEviction() {
    counters.evictions += 1;
  }

  return {
    dimensions,
    embed,
    embedBatch,
    stats,
    onEviction,
  };
}
