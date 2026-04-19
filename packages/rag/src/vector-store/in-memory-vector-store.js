// @ts-check

/**
 * @typedef {Object} VectorRecord
 * @property {string} id Identificador único del vector.
 * @property {number[]} vector
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {Object} SearchHit
 * @property {string} id
 * @property {number} score Cosine similarity en [-1, 1].
 * @property {number[]} vector
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {Object} SearchOptions
 * @property {number} [topK]
 * @property {(meta: Record<string, unknown> | undefined) => boolean} [filter]
 */

/**
 * VectorStore mínimo en memoria con cosine similarity. Sin persistencia,
 * sin índices avanzados — pensado para desarrollo y tests. Ver épica
 * Embedding & Vector Store para backends persistentes (LanceDB, pgvector).
 *
 * @param {{ dimensions: number }} config
 */
export class InMemoryVectorStore {
  constructor(config) {
    if (!config || !Number.isInteger(config.dimensions) || config.dimensions <= 0) {
      throw new Error('InMemoryVectorStore: config.dimensions debe ser entero positivo.');
    }
    /** @type {number} */
    this.dimensions = config.dimensions;
    /** @type {Map<string, VectorRecord>} */
    this._store = new Map();
  }

  /**
   * Inserta o reemplaza un record por id.
   *
   * @param {VectorRecord} record
   */
  upsertOne(record) {
    if (!record || typeof record.id !== 'string' || record.id.length === 0) {
      throw new Error('upsertOne: record.id requerido (string no vacío).');
    }
    if (!Array.isArray(record.vector) || record.vector.length !== this.dimensions) {
      throw new Error(
        `upsertOne: record.vector debe tener dimensión ${this.dimensions} (recibió ${
          record.vector?.length ?? 'n/a'
        }).`,
      );
    }
    this._store.set(record.id, {
      id: record.id,
      vector: record.vector,
      metadata: record.metadata,
    });
  }

  /**
   * Inserta o reemplaza múltiples records.
   *
   * @param {VectorRecord[]} records
   */
  upsert(records) {
    for (const r of records) this.upsertOne(r);
  }

  /**
   * Devuelve el número de records almacenados.
   *
   * @returns {number}
   */
  size() {
    return this._store.size;
  }

  /**
   * Elimina un record por id.
   *
   * @param {string} id
   * @returns {boolean}
   */
  delete(id) {
    return this._store.delete(id);
  }

  /**
   * Busca los topK vectores más similares al query por cosine similarity.
   *
   * @param {number[]} queryVector
   * @param {SearchOptions} [options]
   * @returns {SearchHit[]}
   */
  search(queryVector, options = {}) {
    if (!Array.isArray(queryVector) || queryVector.length !== this.dimensions) {
      throw new Error(`search: queryVector debe tener dimensión ${this.dimensions}.`);
    }
    const topK = options.topK ?? 10;
    const filter = options.filter;

    /** @type {SearchHit[]} */
    const results = [];
    const qNorm = Math.sqrt(queryVector.reduce((s, v) => s + v * v, 0)) || 1;
    for (const record of this._store.values()) {
      if (filter && !filter(record.metadata)) continue;
      let dot = 0;
      let rNorm = 0;
      for (let i = 0; i < this.dimensions; i += 1) {
        dot += queryVector[i] * record.vector[i];
        rNorm += record.vector[i] * record.vector[i];
      }
      const score = dot / (qNorm * (Math.sqrt(rNorm) || 1));
      results.push({
        id: record.id,
        score,
        vector: record.vector,
        metadata: record.metadata,
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }
}
