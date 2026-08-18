// @ts-check
import { createHash } from 'node:crypto';

/**
 * Contrato común de todos los Embedders.
 *
 * @typedef {Object} Embedder
 * @property {number} dimensions Dimensión de los vectores que produce.
 * @property {(text: string) => Promise<number[]>} embed
 * @property {(texts: string[]) => Promise<number[][]>} embedBatch
 */

/**
 * HashEmbedder: embedder determinista basado en SHA-256 del texto.
 *
 * No pretende tener buena semántica — solo estabilidad. Sirve como default
 * para tests, demos y pipelines de baseline antes de enchufar Transformers.js
 * o una API (épica Embedding & Vector Store).
 *
 * @param {{ dimensions?: number }} [options]
 * @returns {Embedder}
 */
export function createHashEmbedder(options = {}) {
  const dimensions = options.dimensions ?? 64;
  if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 4096) {
    throw new Error('createHashEmbedder: "dimensions" debe ser entero en [1, 4096].');
  }

  /**
   * Expande SHA-256 concatenando hashes indexados hasta cubrir la dimensión.
   *
   * @param {string} text
   * @returns {number[]}
   */
  function expandHash(text) {
    /** @type {number[]} */
    const out = new Array(dimensions);
    let bufferPool = Buffer.alloc(0);
    let round = 0;
    while (bufferPool.length < dimensions * 4) {
      const h = createHash('sha256').update(`${round}:${text}`).digest();
      bufferPool = Buffer.concat([bufferPool, h]);
      round += 1;
    }
    for (let i = 0; i < dimensions; i += 1) {
      const val = bufferPool.readUInt32BE(i * 4);
      // Normalizar a [-1, 1] aproximado y luego se L2-normalize.
      out[i] = (val / 0xffffffff) * 2 - 1;
    }
    // L2 normalize para que cosine similarity sea dot product directo.
    let norm = 0;
    for (const v of out) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dimensions; i += 1) out[i] /= norm;
    return out;
  }

  return {
    dimensions,
    async embed(text) {
      return expandHash(String(text ?? ''));
    },
    async embedBatch(texts) {
      return Promise.all(texts.map((t) => expandHash(String(t ?? ''))));
    },
  };
}
