// @ts-check
import { SENSITIVITY_LEVELS } from '../domain/document.js';

/**
 * @typedef {import('../domain/document.js').Sensitivity} Sensitivity
 */

/**
 * Mapa de sensibilidad → providers permitidos. El orden de `providers[sensitivity]`
 * define la preferencia: el primero es el default cuando el usuario no indica uno.
 *
 * @typedef {Record<Sensitivity, string[]>} SensitivityPolicy
 */

/**
 * Policy razonable por defecto para un proyecto RAG personal:
 * - confidential → solo on-premise (ollama).
 * - internal     → on-premise + nubes privadas con garantías de no-training
 *                  (azure-openai, bedrock, vertex-ai). Orden de preferencia:
 *                  primero ollama (si disponible) para ahorrar coste; luego
 *                  las tres nubes privadas.
 * - public       → cualquiera de los 3 CLIs públicos.
 *
 * @returns {SensitivityPolicy}
 */
export function createDefaultSensitivityPolicy() {
  return {
    confidential: ['ollama'],
    internal: ['ollama', 'azure-openai', 'bedrock', 'vertex-ai'],
    public: ['claude', 'codex', 'gemini'],
  };
}

/**
 * Valida que una policy cubra los 3 niveles y todos los providers sean strings.
 *
 * @param {unknown} raw
 * @returns {SensitivityPolicy}
 */
export function validateSensitivityPolicy(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('SensitivityPolicy inválida: debe ser un objeto.');
  }
  const obj = /** @type {Record<string, unknown>} */ (raw);
  for (const level of SENSITIVITY_LEVELS) {
    const list = obj[level];
    if (!Array.isArray(list)) {
      throw new Error(`SensitivityPolicy: falta array para nivel "${level}".`);
    }
    if (!list.every((p) => typeof p === 'string' && p.length > 0)) {
      throw new Error(`SensitivityPolicy: nivel "${level}" contiene providers inválidos.`);
    }
  }
  return /** @type {SensitivityPolicy} */ (obj);
}

/**
 * Resuelve qué provider usar para una sensibilidad dada. Si se indica uno
 * preferido y está permitido, se respeta; si no, se usa el primer permitido.
 * Si no hay ninguno permitido, lanza con mensaje explícito.
 *
 * @param {{ policy: SensitivityPolicy, sensitivity: Sensitivity, preferred?: string }} params
 * @returns {string}
 */
export function resolveAdapterFor(params) {
  const { policy, sensitivity, preferred } = params;
  const allowed = policy[sensitivity];
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw new Error(
      `resolveAdapterFor: no hay providers permitidos para sensibilidad "${sensitivity}".`,
    );
  }
  if (preferred && allowed.includes(preferred)) return preferred;
  if (preferred) {
    // Preferido pero no permitido — se registra en el mensaje del fallback.
    return allowed[0];
  }
  return allowed[0];
}

/**
 * Indica si un provider concreto está permitido para una sensibilidad.
 *
 * @param {SensitivityPolicy} policy
 * @param {Sensitivity} sensitivity
 * @param {string} provider
 * @returns {boolean}
 */
export function isProviderAllowed(policy, sensitivity, provider) {
  const allowed = policy[sensitivity];
  return Array.isArray(allowed) && allowed.includes(provider);
}
