// @ts-check

/**
 * @typedef {Object} BM25Document
 * @property {string} id
 * @property {string} content
 */

/**
 * @typedef {Object} BM25Score
 * @property {string} id
 * @property {number} score
 */

/**
 * Tokeniza un texto a lowercase en palabras alfanuméricas.
 * Implementación mínima en vanilla JS — suficiente para primeros pasos;
 * cuando haga falta se puede sustituir por un tokenizer mejor.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    // Quitar diacríticos sin usar ranges complejos
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * Índice BM25 (Okapi BM25). Acumula documentos y permite consultas.
 * Fórmula estándar con parámetros k1 y b configurables.
 *
 *   IDF(t) = ln((N - df + 0.5) / (df + 0.5) + 1)
 *   tf'(t,d) = tf * (k1 + 1) / (tf + k1 * (1 - b + b * |d|/avgdl))
 *   score(d, q) = Σ_t∈q IDF(t) * tf'(t,d)
 *
 * @param {{ k1?: number, b?: number }} [options]
 */
export class BM25Index {
  constructor(options = {}) {
    this.k1 = options.k1 ?? 1.5;
    this.b = options.b ?? 0.75;
    /** @type {Array<{ id: string, length: number, tf: Map<string, number> }>} */
    this._docs = [];
    /** @type {Map<string, number>} */
    this._df = new Map();
    this._totalLength = 0;
  }

  /**
   * Añade un documento al índice.
   *
   * @param {BM25Document} doc
   */
  add(doc) {
    if (!doc || typeof doc.id !== 'string' || doc.id.length === 0) {
      throw new Error('BM25Index.add: doc.id requerido (string no vacío).');
    }
    const tokens = tokenize(doc.content ?? '');
    /** @type {Map<string, number>} */
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t] of tf) this._df.set(t, (this._df.get(t) ?? 0) + 1);
    this._docs.push({ id: doc.id, length: tokens.length, tf });
    this._totalLength += tokens.length;
  }

  /**
   * Añade varios documentos.
   *
   * @param {BM25Document[]} docs
   */
  addAll(docs) {
    for (const d of docs) this.add(d);
  }

  /**
   * Número de documentos indexados.
   *
   * @returns {number}
   */
  size() {
    return this._docs.length;
  }

  /**
   * Longitud media de documentos (en tokens). 0 si el índice está vacío.
   *
   * @returns {number}
   */
  avgLength() {
    if (this._docs.length === 0) return 0;
    return this._totalLength / this._docs.length;
  }

  /**
   * Calcula scores BM25 para una query, ordenados de mayor a menor.
   *
   * @param {string} query
   * @returns {BM25Score[]}
   */
  score(query) {
    const qTokens = tokenize(query);
    if (qTokens.length === 0 || this._docs.length === 0) return [];
    const N = this._docs.length;
    const avgdl = this.avgLength();
    /** @type {Map<string, number>} */
    const idfCache = new Map();
    for (const t of new Set(qTokens)) {
      const df = this._df.get(t) ?? 0;
      // IDF suavizado tipo Lucene para evitar valores negativos en corpus pequeños.
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      idfCache.set(t, idf);
    }

    const { k1, b } = this;
    /** @type {BM25Score[]} */
    const results = [];
    for (const doc of this._docs) {
      let score = 0;
      for (const t of idfCache.keys()) {
        const tf = doc.tf.get(t);
        if (!tf) continue;
        const idf = idfCache.get(t) ?? 0;
        const num = tf * (k1 + 1);
        const den = tf + k1 * (1 - b + (b * doc.length) / (avgdl || 1));
        score += idf * (num / den);
      }
      if (score > 0) results.push({ id: doc.id, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }
}

/**
 * Factory helper que replica el patrón createHashEmbedder.
 *
 * @param {{ k1?: number, b?: number }} [options]
 * @returns {BM25Index}
 */
export function createBM25Index(options = {}) {
  return new BM25Index(options);
}
