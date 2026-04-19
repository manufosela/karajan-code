// @ts-check
// Inspirado en karajan-code@45fd0f2 src/roles/index.js y src/agents/index.js
// KJR-TSK-0003 · Licencia AGPL-3.0-or-later (ver ADR-001).
//
// Registry sencillo de Roles por nombre. Se expone como clase (en vez de
// las funciones globales que usa KJC con un Map module-level) para
// permitir inyección por DI: cada pipeline puede construir su propio
// registry y pasarlo por constructor al Pipeline Engine.

/**
 * @typedef {import('./role.js').Role} Role
 */

/**
 * @typedef {() => Role} RoleFactory
 *   Función sin argumentos que produce una instancia de Role.
 *   Se usa factory en vez de instancia directa para evitar compartir estado
 *   entre ejecuciones del mismo rol.
 */

/**
 * Registry inyectable de Roles.
 *
 * Uso típico:
 *   const registry = new RoleRegistry();
 *   registry.register('chunker', () => new ChunkerRole({ logger }));
 *   const role = registry.resolve('chunker');
 */
export class RoleRegistry {
  constructor() {
    /** @type {Map<string, RoleFactory>} */
    this._factories = new Map();
  }

  /**
   * Registra un rol por nombre.
   *
   * @param {string} name
   * @param {RoleFactory} factory
   * @returns {void}
   */
  register(name, factory) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('RoleRegistry.register: "name" debe ser un string no vacío.');
    }
    if (typeof factory !== 'function') {
      throw new Error(`RoleRegistry.register("${name}"): factory debe ser una función.`);
    }
    if (this._factories.has(name)) {
      throw new Error(`RoleRegistry.register: ya existe un rol con nombre "${name}".`);
    }
    this._factories.set(name, factory);
  }

  /**
   * Indica si hay un rol registrado con ese nombre.
   *
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._factories.has(name);
  }

  /**
   * Recupera una instancia nueva del rol indicado.
   *
   * @param {string} name
   * @returns {Role}
   */
  resolve(name) {
    const factory = this._factories.get(name);
    if (!factory) {
      const available = [...this._factories.keys()].join(', ') || '<ninguno>';
      throw new Error(
        `RoleRegistry.resolve: rol "${name}" no registrado. Disponibles: ${available}.`,
      );
    }
    return factory();
  }

  /**
   * Lista los nombres registrados (útil para debugging y diagnóstico).
   *
   * @returns {string[]}
   */
  list() {
    return [...this._factories.keys()];
  }

  /**
   * Elimina un rol del registry. Útil en tests.
   *
   * @param {string} name
   * @returns {boolean} true si existía y se eliminó.
   */
  unregister(name) {
    return this._factories.delete(name);
  }
}
