// @ts-check
// Portado de karajan-code@45fd0f20a1a1b5b26bd9e8ac211145460f311a8c src/roles/base-role.js
// KJR-TSK-0015 · Licencia AGPL-3.0-or-later (compatible con KJR).
//
// Adaptaciones respecto al original:
// - Se eliminan dependencias de `getKarajanHome`, `templates/roles/*.md` y
//   resolución de instructions en disco: el patrón KJR recibe las instructions
//   por constructor o las deja a subclases.
// - Se reemplaza el EventEmitter opcional por un simple `notify(event, payload)`
//   que cualquier subclase puede ignorar.
// - `run(input, tools)` sustituye al método de ejecución específico de coding
//   de KJC, acorde con los stages RAG.

/**
 * @typedef {import('./types.js').Logger} Logger
 * @typedef {import('./types.js').ToolBox} ToolBox
 */

export const ROLE_EVENTS = Object.freeze({
  START: 'role:start',
  END: 'role:end',
  ERROR: 'role:error',
});

/**
 * @typedef {Object} RoleOptions
 * @property {string} name Identificador del rol (único por pipeline).
 * @property {Logger} logger Logger estructurado.
 * @property {string} [instructions] Instrucciones o system prompt para el rol.
 * @property {Record<string, unknown>} [config] Config libre específica del rol.
 * @property {(event: string, payload: Record<string, unknown>) => void} [notify]
 *   Callback opcional para emitir eventos de telemetría.
 */

/**
 * Clase base para todos los Roles del pipeline. Un Role encapsula una pieza
 * de lógica reusable que puede o no delegar en un adapter CLI.
 *
 * Subclases DEBEN implementar `run(input, tools)`.
 */
export class Role {
  /**
   * @param {RoleOptions} opts
   */
  constructor(opts) {
    if (!opts || typeof opts.name !== 'string' || opts.name.length === 0) {
      throw new Error('Role: se requiere un "name" no vacío.');
    }
    if (!opts.logger) {
      throw new Error(`Role "${opts.name}": se requiere un "logger".`);
    }
    this.name = opts.name;
    this.logger = opts.logger;
    this.instructions = opts.instructions ?? null;
    this.config = opts.config ?? {};
    this._notify = opts.notify ?? null;
  }

  /**
   * Emite un evento de telemetría si hay callback registrado.
   *
   * @param {string} event
   * @param {Record<string, unknown>} [payload]
   * @returns {void}
   */
  emit(event, payload = {}) {
    if (typeof this._notify === 'function') {
      this._notify(event, { role: this.name, ...payload });
    }
  }

  /**
   * Punto de entrada del rol. Las subclases lo sobrescriben.
   *
   * @param {unknown} _input
   * @param {ToolBox} _tools
   * @returns {Promise<unknown>}
   */
   
  async run(_input, _tools) {
    throw new Error(`Role "${this.name}": run(input, tools) debe implementarse en la subclase.`);
  }

  /**
   * Ejecuta el rol emitiendo eventos START/END/ERROR alrededor.
   * Los consumidores pueden usar esto o llamar a `run` directamente.
   *
   * @param {unknown} input
   * @param {ToolBox} tools
   * @returns {Promise<unknown>}
   */
  async execute(input, tools) {
    this.emit(ROLE_EVENTS.START, { input });
    try {
      const output = await this.run(input, tools);
      this.emit(ROLE_EVENTS.END, { output });
      return output;
    } catch (err) {
      this.emit(ROLE_EVENTS.ERROR, { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
}
