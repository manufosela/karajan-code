// @ts-check
import { Role } from '../pipeline/role.js';

/**
 * @typedef {import('../vector-store/in-memory-vector-store.js').SearchHit} SearchHit
 * @typedef {import('../pipeline/types.js').ToolBox} ToolBox
 * @typedef {import('../ai/types.js').AdapterResult} AdapterResult
 * @typedef {import('../ai/adapter-registry.js').AdapterFunction} AdapterFunction
 */

/**
 * Role que compone un prompt con contexto recuperado y delega en un CLI
 * para generar la respuesta final del pipeline RAG.
 *
 * Pattern:
 *   [system/instructions opcionales]
 *   Contexto:
 *     [i] <chunk.content>
 *     ...
 *   Pregunta: <query>
 *   Responde basándote solo en el contexto...
 */
export class GeneratorRole extends Role {
  /**
   * @param {{
   *   name: string,
   *   logger: import('../pipeline/types.js').Logger,
   *   adapter?: AdapterFunction,
   *   adapterName?: string,
   *   instructions?: string,
   * }} opts
   */
  constructor(opts) {
    super({
      name: opts.name,
      logger: opts.logger,
      instructions: opts.instructions,
    });
    this.adapter = opts.adapter ?? null;
    this.adapterName = opts.adapterName ?? null;
  }

  /**
   * @param {{ query: string, contextChunks?: SearchHit[] }} input
   * @param {ToolBox} tools
   * @returns {Promise<{ answer: string, raw: AdapterResult, prompt: string }>}
   */
  async run(input, tools) {
    if (!input || typeof input.query !== 'string' || input.query.length === 0) {
      throw new Error('GeneratorRole.run: input.query requerido.');
    }
    const adapter = this.#resolveAdapter(tools);
    const prompt = this.buildPrompt(input.query, input.contextChunks ?? []);
    const raw = await adapter(prompt);
    return { answer: this.#extractAnswer(raw), raw, prompt };
  }

  /**
   * Compone el prompt. Se expone para permitir testearlo y reusarlo.
   *
   * @param {string} query
   * @param {SearchHit[]} hits
   * @returns {string}
   */
  buildPrompt(query, hits) {
    /** @type {string[]} */
    const parts = [];
    if (this.instructions) parts.push(this.instructions);
    if (hits.length > 0) {
      parts.push('Contexto:');
      hits.forEach((h, i) => {
        const text = String(h.metadata?.content ?? '').slice(0, 1500);
        parts.push(`[${i + 1}] id=${h.id}\n${text}`);
      });
    } else {
      parts.push('(Sin contexto recuperado.)');
    }
    parts.push('');
    parts.push(`Pregunta: ${query}`);
    parts.push(
      'Responde basándote SOLO en el contexto proporcionado. Si el contexto es insuficiente, dilo explícitamente.',
    );
    return parts.join('\n');
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
    throw new Error('GeneratorRole: no hay adapter inyectado ni disponible en tools.');
  }

  /**
   * @param {AdapterResult} result
   * @returns {string}
   */
  #extractAnswer(result) {
    const parsed = result?.parsedOutput;
    if (!parsed) return '';
    if (parsed.format === 'json' && parsed.json && typeof parsed.json === 'object') {
      const obj = /** @type {any} */ (parsed.json);
      if (typeof obj.answer === 'string') return obj.answer;
    }
    return parsed.text ?? '';
  }
}
