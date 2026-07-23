// @ts-check
/**
 * Capa Easy RAG — sensibilidad del corpus (KJR-BUG-0006, ADR-005 §6).
 *
 * La sensibilidad se declara en `karajan.config.json` (nivel global +
 * excepciones por prefijo), se estampa por documento al indexar y el
 * nivel efectivo de una consulta es el MÁXIMO de los chunks recuperados:
 * un solo chunk confidential hace confidential a toda la respuesta.
 */
import { DEFAULT_SENSITIVITY, maxSensitivity, SENSITIVITY_LEVELS } from '../domain/document.js';

/**
 * @typedef {import('../domain/document.js').Sensitivity} Sensitivity
 * @typedef {import('./config.js').EasyConfig} EasyConfig
 */

/**
 * Nivel de un documento según la config easy: primera regla por prefijo
 * que matchea > nivel global del corpus > default seguro (internal).
 *
 * @param {string} relPath Ruta relativa del fichero dentro del corpus.
 * @param {EasyConfig | null | undefined} config
 * @returns {Sensitivity}
 */
export function resolveDocumentSensitivity(relPath, config) {
  if (!config) return DEFAULT_SENSITIVITY;
  for (const rule of config.sensitivityRules ?? []) {
    if (relPath.startsWith(rule.prefix)) return rule.level;
  }
  if (config.sensitivity && SENSITIVITY_LEVELS.includes(config.sensitivity)) {
    return config.sensitivity;
  }
  return DEFAULT_SENSITIVITY;
}

/**
 * Nivel efectivo de un conjunto de hits recuperados: el máximo de sus
 * niveles. Los hits sin marca (índices pre-0.7.0) cuentan como el
 * default seguro, nunca como public.
 *
 * @param {readonly { sensitivity?: Sensitivity }[]} hits
 * @returns {Sensitivity}
 */
export function effectiveSensitivityOfHits(hits) {
  return maxSensitivity(hits.map((hit) => hit.sensitivity ?? DEFAULT_SENSITIVITY));
}
