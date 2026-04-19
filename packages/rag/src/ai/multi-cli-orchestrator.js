// @ts-check
import { createDefaultAdapterRegistry } from './adapter-registry.js';

/**
 * @typedef {import('./adapter-registry.js').AdapterRegistry} AdapterRegistry
 * @typedef {import('./types.js').AdapterResult} AdapterResult
 */

/**
 * @typedef {Object} ProviderErrorResult
 * @property {string} provider Identificador del proveedor que falló.
 * @property {string} error Mensaje humano.
 */

/**
 * @typedef {Object} OrchestratorOptions
 * @property {AdapterRegistry} [registry] Registry de adapters inyectable. Si no se pasa,
 *   se crea uno por defecto con los 3 built-in (claude/codex/gemini).
 * @property {string[]} [providers] Subconjunto de providers a ejecutar. Por defecto todos los
 *   registrados en el registry.
 */

/**
 * Convierte una rejection en un objeto de error normalizado.
 *
 * @param {string} provider
 * @param {unknown} reason
 * @returns {ProviderErrorResult}
 */
function buildErrorResult(provider, reason) {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'Error desconocido al ejecutar el proveedor';
  return { provider, error: message };
}

/**
 * Ejecuta el mismo prompt contra todos los adapters del registry en paralelo
 * usando Promise.allSettled. Si un proveedor falla, el resto sigue; el error
 * se devuelve normalizado y el array de resultados mantiene el orden de los
 * providers solicitados.
 *
 * @param {string} prompt
 * @param {OrchestratorOptions} [options]
 * @returns {Promise<Array<AdapterResult | ProviderErrorResult>>}
 */
export async function runMultiCli(prompt, options = {}) {
  const registry = options.registry ?? (await createDefaultAdapterRegistry());
  const providers = options.providers ?? registry.list();

  if (providers.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    providers.map((name) => registry.get(name)(prompt)),
  );

  return settled.map((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      return /** @type {AdapterResult} */ (outcome.value);
    }
    return buildErrorResult(providers[index], outcome.reason);
  });
}
