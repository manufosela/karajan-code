// @ts-check
/**
 * Capa Easy RAG — configuración `karajan.config.json` (ADR-005 §2).
 *
 * Fichero opcional en la raíz del proyecto indexado con la sección
 * `easy`. Los comandos funcionan sin él (defaults deterministas) y los
 * flags de CLI siempre ganan sobre la config. Config presente pero
 * inválida → error explícito, nunca se ignora en silencio.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SENSITIVITY, SENSITIVITY_LEVELS } from '../domain/document.js';

export const CONFIG_FILE = 'karajan.config.json';

/**
 * @typedef {import('../domain/document.js').Sensitivity} Sensitivity
 *
 * @typedef {object} SensitivityRule
 * @property {string} prefix Prefijo de ruta relativa (ej. "docs/public/").
 * @property {Sensitivity} level Nivel asignado a los ficheros bajo ese prefijo.
 *
 * @typedef {object} EasyConfig
 * @property {'lancedb' | 'pgvector' | 'in-memory'} [store]
 * @property {'hash' | 'transformers'} [embedder]
 * @property {number} [dimensions]
 * @property {number} [topK]
 * @property {string} [adapter]
 * @property {Sensitivity} [sensitivity] Nivel del corpus completo (default seguro: internal).
 * @property {SensitivityRule[]} [sensitivityRules] Excepciones por prefijo; gana la primera que matchea.
 */

const VALID_KEYS = Object.freeze([
  'store', 'embedder', 'dimensions', 'topK', 'adapter', 'sensitivity', 'sensitivityRules',
]);
const VALID_STORES = Object.freeze(['lancedb', 'pgvector', 'in-memory']);
const VALID_EMBEDDERS = Object.freeze(['hash', 'transformers']);

/** Config generada por `init` con los defaults ADR-005. */
export const DEFAULT_EASY_CONFIG = Object.freeze({
  store: 'lancedb',
  embedder: 'hash',
  dimensions: 256,
  topK: 5,
  adapter: 'claude',
  sensitivity: DEFAULT_SENSITIVITY,
});

/**
 * Valida la sección `easy` de una config deserializada.
 *
 * @param {unknown} value
 * @returns {EasyConfig}
 */
export function validateEasyConfig(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('karajan.config.json: la sección "easy" debe ser un objeto.');
  }
  const config = /** @type {Record<string, unknown>} */ (value);
  for (const key of Object.keys(config)) {
    if (!VALID_KEYS.includes(key)) {
      throw new Error(
        `karajan.config.json: clave "easy.${key}" no reconocida (válidas: ${VALID_KEYS.join(', ')}).`,
      );
    }
  }
  if (config.store !== undefined && !VALID_STORES.includes(/** @type {never} */ (config.store))) {
    throw new Error(`karajan.config.json: easy.store debe ser uno de ${VALID_STORES.join(', ')}.`);
  }
  if (
    config.embedder !== undefined &&
    !VALID_EMBEDDERS.includes(/** @type {never} */ (config.embedder))
  ) {
    throw new Error(
      `karajan.config.json: easy.embedder debe ser uno de ${VALID_EMBEDDERS.join(', ')}.`,
    );
  }
  for (const key of ['dimensions', 'topK']) {
    const raw = config[key];
    if (raw !== undefined && (!Number.isInteger(raw) || /** @type {number} */ (raw) <= 0)) {
      throw new Error(`karajan.config.json: easy.${key} debe ser un entero positivo.`);
    }
  }
  if (config.adapter !== undefined && typeof config.adapter !== 'string') {
    throw new Error('karajan.config.json: easy.adapter debe ser un string.');
  }
  if (
    config.sensitivity !== undefined &&
    !SENSITIVITY_LEVELS.includes(/** @type {never} */ (config.sensitivity))
  ) {
    throw new Error(
      `karajan.config.json: easy.sensitivity debe ser uno de ${SENSITIVITY_LEVELS.join(', ')}.`,
    );
  }
  if (config.sensitivityRules !== undefined) {
    if (!Array.isArray(config.sensitivityRules)) {
      throw new Error('karajan.config.json: easy.sensitivityRules debe ser un array.');
    }
    for (const rule of config.sensitivityRules) {
      const valid =
        rule !== null &&
        typeof rule === 'object' &&
        typeof (/** @type {SensitivityRule} */ (rule).prefix) === 'string' &&
        /** @type {SensitivityRule} */ (rule).prefix.length > 0 &&
        SENSITIVITY_LEVELS.includes(/** @type {never} */ (/** @type {SensitivityRule} */ (rule).level));
      if (!valid) {
        throw new Error(
          'karajan.config.json: cada regla de easy.sensitivityRules necesita ' +
            `{ prefix: string, level: ${SENSITIVITY_LEVELS.join(' | ')} }.`,
        );
      }
      // Pasada 2 de la revisión independiente: formas ambiguas se rechazan
      // en vez de normalizarse en silencio — el prefijo debe ser una ruta
      // relativa limpia con separador /, tal como las produce el indexer.
      const prefix = /** @type {SensitivityRule} */ (rule).prefix;
      const ambiguous =
        prefix.includes('\\') ||
        prefix.startsWith('/') ||
        prefix === '.' ||
        prefix.startsWith('./') ||
        prefix.startsWith('..') ||
        prefix.split('/').some((seg) => seg === '..');
      if (ambiguous) {
        throw new Error(
          `karajan.config.json: prefijo ambiguo "${prefix}" en easy.sensitivityRules — ` +
            'usa una ruta relativa limpia con "/" (ej. "docs/public/"), sin "./", ".." ni "\\".',
        );
      }
    }
  }
  return /** @type {EasyConfig} */ (config);
}

/**
 * Carga la sección `easy` de `<root>/karajan.config.json`, o null si el
 * fichero no existe.
 *
 * @param {string} rootDir
 * @returns {Promise<EasyConfig | null>}
 */
export async function loadEasyConfig(rootDir) {
  let raw;
  try {
    raw = await readFile(path.join(rootDir, CONFIG_FILE), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${CONFIG_FILE}: JSON inválido.`);
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.easy === undefined) {
    throw new Error(`${CONFIG_FILE}: falta la sección "easy".`);
  }
  return validateEasyConfig(parsed.easy);
}

/**
 * Escribe `<root>/karajan.config.json` con la sección `easy` dada.
 *
 * @param {string} rootDir
 * @param {EasyConfig} easy
 * @returns {Promise<void>}
 */
export async function saveEasyConfig(rootDir, easy) {
  const content = `${JSON.stringify({ easy: validateEasyConfig(easy) }, null, 2)}\n`;
  await writeFile(path.join(rootDir, CONFIG_FILE), content, 'utf8');
}
