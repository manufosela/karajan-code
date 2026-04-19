// @ts-check
import { Role } from '../pipeline/role.js';

/**
 * @typedef {import('../vector-store/in-memory-vector-store.js').SearchHit} SearchHit
 * @typedef {import('../pipeline/types.js').ToolBox} ToolBox
 */

/**
 * @typedef {Object} SolomonSourceResult
 * @property {string} source Identificador del corpus (p.ej. "docs", "policies", "chat-history").
 * @property {SearchHit[]} hits Top-k local de ese source.
 */

/**
 * @typedef {Object} SolomonInput
 * @property {string} query Query original del usuario.
 * @property {SolomonSourceResult[]} sourceResults Retrievals paralelos por source.
 * @property {number} [maxChunks] Máximo global de chunks a devolver tras arbitraje.
 */

/**
 * @typedef {Object} SolomonVerdict
 * @property {SearchHit[]} chunks Chunks finales ordenados por relevancia global.
 * @property {string} rationale Una línea explicando la decisión.
 * @property {Record<string, number>} sourceWeights Peso aplicado a cada source en la mezcla.
 */

/**
 * SolomonRole — slot arquitectónico para arbitraje multi-source.
 *
 * Hoy es un STUB: run() lanza con referencia a ADR-003. Existe para que
 * pipelines multi-source puedan declararlo y el RoleRegistry lo acepte
 * sin romper, de modo que la implementación real no requiera rediseñar
 * el engine cuando llegue. Ver docs/adrs/ADR-003-solomon-slot.md.
 */
export class SolomonRole extends Role {
  /**
   * @param {{
   *   name: string,
   *   logger: import('../pipeline/types.js').Logger,
   * }} opts
   */
  constructor(opts) {
    super({ name: opts.name, logger: opts.logger });
  }

  /**
   * @param {SolomonInput} _input
   * @param {ToolBox} _tools
   * @returns {Promise<SolomonVerdict>}
   */
  // eslint-disable-next-line no-unused-vars
  async run(_input, _tools) {
    throw new Error('Solomon: not implemented, see ADR-003');
  }
}
