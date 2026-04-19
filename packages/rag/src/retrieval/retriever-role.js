// @ts-check
import { Role } from '../pipeline/role.js';

/**
 * @typedef {import('../embedding/embedder.js').Embedder} Embedder
 * @typedef {import('../vector-store/in-memory-vector-store.js').SearchHit} SearchHit
 * @typedef {import('../pipeline/types.js').ToolBox} ToolBox
 */

/**
 * Role que convierte una query textual en top-K hits contra un vector store,
 * usando un Embedder inyectado.
 *
 * Uso:
 *   const role = new RetrieverRole({ name:'retriever', logger, embedder, store });
 *   const hits = await role.run({ query: 'foo', topK: 3 }, tools);
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
  }

  /**
   * @param {{ query: string, topK?: number, filter?: (meta: Record<string, unknown> | undefined) => boolean }} input
   * @param {ToolBox} _tools
   * @returns {Promise<SearchHit[]>}
   */
  async run(input, _tools) {
    if (!input || typeof input.query !== 'string' || input.query.length === 0) {
      throw new Error('RetrieverRole.run: input.query requerido.');
    }
    const topK = input.topK ?? this.defaultTopK;
    const filter = input.filter ?? this.defaultFilter;
    const queryVector = await this.embedder.embed(input.query);
    return this.store.search(queryVector, { topK, filter });
  }
}
