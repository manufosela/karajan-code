// @ts-check
import { Role } from '../pipeline/role.js';

/**
 * @typedef {import('../embedding/embedder.js').Embedder} Embedder
 * @typedef {import('../vector-store/in-memory-vector-store.js').SearchHit} SearchHit
 * @typedef {import('../pipeline/types.js').ToolBox} ToolBox
 * @typedef {import('./bm25.js').BM25Index} BM25Index
 */

/**
 * Role que convierte una query textual en top-K hits.
 *
 * Modos soportados:
 * - 'vector' (default): embed(query) → store.search.
 * - 'hybrid': combina score vectorial y BM25 con pesos alpha y 1-alpha.
 * - 'bm25': solo keyword matching (alpha implícito 0).
 *
 * Threshold filtra hits por score mínimo final. Si todos caen bajo el
 * umbral, devuelve array vacío.
 */
export class RetrieverRole extends Role {
  /**
   * @param {{
   *   name: string,
   *   logger: import('../pipeline/types.js').Logger,
   *   embedder: Embedder,
   *   store: { search: (v: number[], opts?: object) => SearchHit[] },
   *   defaultTopK?: number,
   *   defaultFilter?: (meta: Record<string, unknown> | undefined) => boolean,
   *   mode?: "vector" | "hybrid" | "bm25",
   *   bm25?: BM25Index,
   *   hybridAlpha?: number,
   *   similarityThreshold?: number,
   * }} opts
   */
  constructor(opts) {
    super({ name: opts.name, logger: opts.logger });
    if (!opts.embedder) throw new Error('RetrieverRole: "embedder" requerido.');
    if (!opts.store || typeof opts.store.search !== 'function') {
      throw new Error('RetrieverRole: "store" con método search() requerido.');
    }
    this.embedder = opts.embedder;
    this.store = opts.store;
    this.defaultTopK = opts.defaultTopK ?? 5;
    this.defaultFilter = opts.defaultFilter;
    this.mode = opts.mode ?? 'vector';
    if (!['vector', 'hybrid', 'bm25'].includes(this.mode)) {
      throw new Error(`RetrieverRole: mode inválido "${this.mode}".`);
    }
    this.bm25 = opts.bm25 ?? null;
    this.hybridAlpha = opts.hybridAlpha ?? 0.5;
    if (this.hybridAlpha < 0 || this.hybridAlpha > 1) {
      throw new Error('RetrieverRole: "hybridAlpha" debe estar en [0, 1].');
    }
    this.similarityThreshold = opts.similarityThreshold ?? null;
    if ((this.mode === 'hybrid' || this.mode === 'bm25') && !this.bm25) {
      throw new Error(
        `RetrieverRole: mode "${this.mode}" requiere una instancia BM25Index en opts.bm25.`,
      );
    }
  }

  /**
   * @param {{
   *   query: string,
   *   topK?: number,
   *   filter?: (meta: Record<string, unknown> | undefined) => boolean,
   *   mode?: "vector" | "hybrid" | "bm25",
   *   hybridAlpha?: number,
   *   similarityThreshold?: number,
   * }} input
   * @param {ToolBox} _tools
   * @returns {Promise<SearchHit[]>}
   */
  async run(input, _tools) {
    if (!input || typeof input.query !== 'string' || input.query.length === 0) {
      throw new Error('RetrieverRole.run: input.query requerido.');
    }
    const topK = input.topK ?? this.defaultTopK;
    const filter = input.filter ?? this.defaultFilter;
    const mode = input.mode ?? this.mode;
    const alpha = input.hybridAlpha ?? this.hybridAlpha;
    const threshold = input.similarityThreshold ?? this.similarityThreshold;

    let hits;
    if (mode === 'vector') {
      const queryVector = await this.embedder.embed(input.query);
      hits = this.store.search(queryVector, { topK, filter });
    } else if (mode === 'bm25') {
      hits = this.#bm25Hits(input.query, topK, filter);
    } else {
      hits = await this.#hybridHits(input.query, topK, filter, alpha);
    }

    if (threshold !== null && threshold !== undefined) {
      hits = hits.filter((h) => h.score >= threshold);
    }
    return hits;
  }

  /**
   * Retrieval BM25 puro, sobre el store (usa su lista completa como universo).
   *
   * @param {string} query
   * @param {number} topK
   * @param {undefined | ((meta: Record<string, unknown> | undefined) => boolean)} filter
   * @returns {SearchHit[]}
   */
  #bm25Hits(query, topK, filter) {
    if (!this.bm25) return [];
    const scores = this.bm25.score(query);
    const filtered = filter
      ? scores.filter((s) => {
          const vec = this.#getVectorById(s.id);
          return filter(vec?.metadata);
        })
      : scores;
    return filtered.slice(0, topK).map((s) => {
      const vec = this.#getVectorById(s.id);
      return {
        id: s.id,
        score: s.score,
        vector: vec?.vector ?? [],
        metadata: vec?.metadata,
      };
    });
  }

  /**
   * Hybrid: normaliza min-max por componente y combina con alpha.
   *
   * @param {string} query
   * @param {number} topK
   * @param {undefined | ((meta: Record<string, unknown> | undefined) => boolean)} filter
   * @param {number} alpha Peso del score vectorial (0..1).
   * @returns {Promise<SearchHit[]>}
   */
  async #hybridHits(query, topK, filter, alpha) {
    const queryVector = await this.embedder.embed(query);
    // Traemos top-N amplios para no dejar fuera candidatos por no estar en
    // ambos rankings top-K (heurística: 3×topK cuando hay mucho recall).
    const over = Math.max(topK * 3, 20);
    const vectorHits = this.store.search(queryVector, { topK: over, filter });
    const bm25Hits = this.bm25 ? this.bm25.score(query) : [];

    const normalize = (values) => {
      if (values.length === 0) return new Map();
      const min = Math.min(...values.map((v) => v.score));
      const max = Math.max(...values.map((v) => v.score));
      const span = max - min || 1;
      return new Map(values.map((v) => [v.id, (v.score - min) / span]));
    };

    const vectorNorm = normalize(vectorHits);
    const bm25Norm = normalize(bm25Hits);

    /** @type {Map<string, { id: string, score: number, hit?: SearchHit }>} */
    const combined = new Map();
    for (const [id, v] of vectorNorm) {
      const hit = vectorHits.find((h) => h.id === id);
      combined.set(id, { id, score: alpha * v, hit });
    }
    for (const [id, v] of bm25Norm) {
      const existing = combined.get(id);
      const b = (1 - alpha) * v;
      if (existing) existing.score += b;
      else combined.set(id, { id, score: b });
    }

    const final = [...combined.values()]
      .filter((c) => {
        if (!filter) return true;
        const hit = c.hit ?? this.#getVectorById(c.id);
        return filter(hit?.metadata);
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((c) => {
        const base = c.hit ?? this.#getVectorById(c.id);
        return {
          id: c.id,
          score: c.score,
          vector: base?.vector ?? [],
          metadata: base?.metadata,
        };
      });
    return final;
  }

  /**
   * Intenta recuperar un record del store por id (para rellenar vector/metadata
   * en modos BM25 o Hybrid). Usa el método `get` si existe; si no, fallback a
   * listar y filtrar (lento pero funcional; el InMemoryVectorStore lo soporta).
   *
   * @param {string} id
   * @returns {SearchHit | null}
   */
  #getVectorById(id) {
    const store = /** @type {any} */ (this.store);
    if (typeof store.get === 'function') return store.get(id) ?? null;
    if (typeof store._store?.get === 'function') {
      const rec = store._store.get(id);
      return rec ? { id: rec.id, score: 0, vector: rec.vector, metadata: rec.metadata } : null;
    }
    return null;
  }
}
