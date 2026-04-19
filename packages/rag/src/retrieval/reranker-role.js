// @ts-check
import { Role } from '../pipeline/role.js';

/**
 * @typedef {import('../vector-store/in-memory-vector-store.js').SearchHit} SearchHit
 * @typedef {import('../pipeline/types.js').ToolBox} ToolBox
 * @typedef {import('../ai/types.js').AdapterResult} AdapterResult
 * @typedef {import('../ai/adapter-registry.js').AdapterFunction} AdapterFunction
 */

/**
 * Rerankea una lista de hits.
 *
 * - Modo "score" (determinista): simplemente ordena por score descendente
 *   (útil cuando el retriever ya devuelve el orden correcto pero querés un
 *   paso explícito en el pipeline para telemetría).
 * - Modo "llm": delega en un adapter (obtenido del AdapterRegistry o vía
 *   la propiedad `adapter` del rol) que recibe prompt+hits y devuelve
 *   un JSON { ranking: string[] } con los IDs ordenados.
 */
export class RerankerRole extends Role {
  /**
   * @param {{
   *   name: string,
   *   logger: import('../pipeline/types.js').Logger,
   *   mode?: "score" | "llm",
   *   adapter?: AdapterFunction,
   *   adapterName?: string,
   * }} opts
   */
  constructor(opts) {
    super({ name: opts.name, logger: opts.logger });
    this.mode = opts.mode ?? 'score';
    if (this.mode !== 'score' && this.mode !== 'llm') {
      throw new Error(`RerankerRole: mode inválido "${this.mode}".`);
    }
    this.adapter = opts.adapter ?? null;
    this.adapterName = opts.adapterName ?? null;
  }

  /**
   * @param {{ query: string, hits: SearchHit[] }} input
   * @param {ToolBox} tools
   * @returns {Promise<SearchHit[]>}
   */
  async run(input, tools) {
    if (!input || !Array.isArray(input.hits)) {
      throw new Error('RerankerRole.run: input.hits array requerido.');
    }
    if (this.mode === 'score') {
      return [...input.hits].sort((a, b) => b.score - a.score);
    }
    // mode === 'llm'
    const adapter = this.#resolveAdapter(tools);
    const prompt = this.#buildPrompt(input.query, input.hits);
    const result = await adapter(prompt);
    const ranking = this.#extractRanking(result);
    const byId = new Map(input.hits.map((h) => [h.id, h]));
    const reordered = [];
    for (const id of ranking) {
      const hit = byId.get(id);
      if (hit) reordered.push(hit);
    }
    // Añade al final cualquier hit no listado por el LLM (fallback defensivo).
    for (const hit of input.hits) {
      if (!ranking.includes(hit.id)) reordered.push(hit);
    }
    return reordered;
  }

  /**
   * @param {ToolBox} tools
   * @returns {AdapterFunction}
   */
  #resolveAdapter(tools) {
    if (this.adapter) return this.adapter;
    if (this.adapterName && tools?.has?.(this.adapterName)) {
      const fn = tools.get(this.adapterName);
      if (typeof fn === 'function') return /** @type {AdapterFunction} */ (fn);
    }
    throw new Error(
      'RerankerRole(llm): no hay adapter inyectado ni disponible en tools.',
    );
  }

  /**
   * @param {string} query
   * @param {SearchHit[]} hits
   * @returns {string}
   */
  #buildPrompt(query, hits) {
    const items = hits
      .map((h, i) => `${i + 1}. id=${h.id}\n${String(h.metadata?.content ?? '').slice(0, 500)}`)
      .join('\n---\n');
    return [
      'Eres un reranker. Reordena los siguientes fragmentos por relevancia para la query.',
      `Query: ${query}`,
      '',
      'Fragmentos:',
      items,
      '',
      'Responde EXCLUSIVAMENTE con un JSON: { "ranking": ["id1","id2",...] }.',
    ].join('\n');
  }

  /**
   * @param {AdapterResult | unknown} result
   * @returns {string[]}
   */
  #extractRanking(result) {
    const res = /** @type {AdapterResult} */ (result);
    const json = res?.parsedOutput?.json;
    if (json && typeof json === 'object' && Array.isArray(/** @type {any} */ (json).ranking)) {
      return /** @type {any} */ (json).ranking.filter((x) => typeof x === 'string');
    }
    return [];
  }
}
