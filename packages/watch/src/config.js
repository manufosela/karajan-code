// @ts-check
/**
 * Esquema y validación de `karajan-watch.config.json`.
 *
 * Todo lo concreto de una organización (repos observados, corpus, niveles
 * de sensibilidad, umbrales, destinos de aviso) vive en su repo de
 * despliegue como un fichero de configuración validado por este módulo.
 * karajan-watch permanece genérico.
 *
 * Reglas: validación estricta (clave desconocida = error), errores con el
 * path exacto de la clave (`$.corpus.code.store`), sin fallbacks
 * silenciosos. Los únicos defaults son explícitos y documentados:
 * `branch: "main"` y `sensitivity: DEFAULT_SENSITIVITY` (el default seguro
 * de karajan-rag).
 */
import { readFile } from 'node:fs/promises';
import { SENSITIVITY_LEVELS, DEFAULT_SENSITIVITY } from 'karajan-rag';

/** Stores soportados por `karajan-rag index --store`. */
export const VALID_STORES = Object.freeze(['lancedb', 'pgvector', 'in-memory']);

/** Embedders soportados por `karajan-rag index --embedder` (locales; el código no viaja a terceros). */
export const VALID_EMBEDDERS = Object.freeze(['hash', 'transformers']);

/** Tipos de destino de aviso soportados. */
export const VALID_NOTIFY_TYPES = Object.freeze(['pr-comment', 'webhook']);

/**
 * Error de configuración con el path exacto de la clave inválida.
 */
export class ConfigError extends Error {
  /**
   * @param {string} path Path JSON de la clave (p. ej. `$.repos[0].name`).
   * @param {string} detail Qué se esperaba y qué se encontró.
   * @param {{cause?: unknown}} [options]
   */
  constructor(path, detail, options) {
    super(`Config inválida en "${path}": ${detail}`, options);
    this.name = 'ConfigError';
    this.path = path;
  }
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} path
 * @param {readonly string[]} allowedKeys
 */
const rejectUnknownKeys = (obj, path, allowedKeys) => {
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key)) {
      throw new ConfigError(`${path}.${key}`, 'clave desconocida.');
    }
  }
};

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
const requireObject = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(path, 'se esperaba un objeto.');
  }
  return /** @type {Record<string, unknown>} */ (value);
};

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {string}
 */
const requireNonEmptyString = (value, path) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(path, 'se esperaba un string no vacío.');
  }
  return value;
};

/**
 * @param {unknown} value
 * @param {string} path
 * @param {readonly string[]} allowed
 * @returns {string}
 */
const requireOneOf = (value, path, allowed) => {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ConfigError(path, `se esperaba uno de: ${allowed.join(' | ')}.`);
  }
  return value;
};

/**
 * @typedef {import('karajan-rag').Sensitivity} Sensitivity
 *
 * @typedef {Object} RepoConfig
 * @property {string} name Nombre único del repo (namespace de sus paths en el corpus).
 * @property {string} branch Rama observada cuyos merges disparan la ingesta.
 * @property {Sensitivity} sensitivity Nivel de sensibilidad del repo.
 *
 * @typedef {Object} CorpusConfig
 * @property {string} store Vector store de karajan-rag.
 * @property {string} embedder Embedder local de karajan-rag.
 * @property {Sensitivity} sensitivity Nivel de sensibilidad del corpus.
 *
 * @typedef {Object} ImpactThresholds
 * @property {number} [minSimilarity] Similitud mínima [0, 1] para considerar un candidato.
 * @property {number} [maxCandidates] Máximo de candidatos (entero >= 1).
 *
 * @typedef {{type: 'pr-comment'} | {type: 'webhook', url: string}} NotifyTarget
 *
 * @typedef {Object} WatchConfig
 * @property {RepoConfig[]} repos
 * @property {{code: CorpusConfig, docs: CorpusConfig}} corpus
 * @property {{thresholds: ImpactThresholds}} [impact]
 * @property {{targets: NotifyTarget[]}} [notify]
 */

/**
 * @param {unknown} value
 * @param {string} path
 * @param {Set<string>} seenNames
 * @returns {RepoConfig}
 */
const validateRepo = (value, path, seenNames) => {
  const repo = requireObject(value, path);
  rejectUnknownKeys(repo, path, ['name', 'branch', 'sensitivity']);
  const name = requireNonEmptyString(repo.name, `${path}.name`);
  if (seenNames.has(name)) {
    throw new ConfigError(`${path}.name`, `nombre de repo duplicado: "${name}".`);
  }
  seenNames.add(name);
  const branch =
    repo.branch === undefined ? 'main' : requireNonEmptyString(repo.branch, `${path}.branch`);
  const sensitivity =
    repo.sensitivity === undefined
      ? DEFAULT_SENSITIVITY
      : requireOneOf(repo.sensitivity, `${path}.sensitivity`, SENSITIVITY_LEVELS);
  return { name, branch, sensitivity: /** @type {Sensitivity} */ (sensitivity) };
};

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {CorpusConfig}
 */
const validateCorpusEntry = (value, path) => {
  const corpus = requireObject(value, path);
  rejectUnknownKeys(corpus, path, ['store', 'embedder', 'sensitivity']);
  const store = requireOneOf(corpus.store, `${path}.store`, VALID_STORES);
  const embedder = requireOneOf(corpus.embedder, `${path}.embedder`, VALID_EMBEDDERS);
  const sensitivity =
    corpus.sensitivity === undefined
      ? DEFAULT_SENSITIVITY
      : requireOneOf(corpus.sensitivity, `${path}.sensitivity`, SENSITIVITY_LEVELS);
  return { store, embedder, sensitivity: /** @type {Sensitivity} */ (sensitivity) };
};

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {{thresholds: ImpactThresholds}}
 */
const validateImpact = (value, path) => {
  const impact = requireObject(value, path);
  rejectUnknownKeys(impact, path, ['thresholds']);
  const thresholds = requireObject(impact.thresholds, `${path}.thresholds`);
  rejectUnknownKeys(thresholds, `${path}.thresholds`, ['minSimilarity', 'maxCandidates']);
  /** @type {ImpactThresholds} */
  const result = {};
  if (thresholds.minSimilarity !== undefined) {
    const { minSimilarity } = thresholds;
    if (typeof minSimilarity !== 'number' || minSimilarity < 0 || minSimilarity > 1) {
      throw new ConfigError(`${path}.thresholds.minSimilarity`, 'se esperaba un número en [0, 1].');
    }
    result.minSimilarity = minSimilarity;
  }
  if (thresholds.maxCandidates !== undefined) {
    const { maxCandidates } = thresholds;
    if (!Number.isInteger(maxCandidates) || /** @type {number} */ (maxCandidates) < 1) {
      throw new ConfigError(`${path}.thresholds.maxCandidates`, 'se esperaba un entero >= 1.');
    }
    result.maxCandidates = /** @type {number} */ (maxCandidates);
  }
  return { thresholds: result };
};

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {NotifyTarget}
 */
const validateNotifyTarget = (value, path) => {
  const target = requireObject(value, path);
  const type = requireOneOf(target.type, `${path}.type`, VALID_NOTIFY_TYPES);
  if (type === 'webhook') {
    rejectUnknownKeys(target, path, ['type', 'url']);
    const url = requireNonEmptyString(target.url, `${path}.url`);
    if (!url.startsWith('https://')) {
      throw new ConfigError(`${path}.url`, 'se esperaba una URL https.');
    }
    return { type, url };
  }
  rejectUnknownKeys(target, path, ['type']);
  return { type: 'pr-comment' };
};

/**
 * Valida y normaliza una configuración de karajan-watch.
 * Lanza {@link ConfigError} con el path exacto ante la primera clave inválida.
 *
 * @param {unknown} raw
 * @returns {WatchConfig}
 */
export const validateConfig = (raw) => {
  const config = requireObject(raw, '$');
  rejectUnknownKeys(config, '$', ['repos', 'corpus', 'impact', 'notify']);

  if (!Array.isArray(config.repos) || config.repos.length === 0) {
    throw new ConfigError('$.repos', 'se esperaba un array no vacío de repos.');
  }
  const seenNames = new Set();
  const repos = config.repos.map((repo, i) => validateRepo(repo, `$.repos[${i}]`, seenNames));

  const corpusRoot = requireObject(config.corpus, '$.corpus');
  rejectUnknownKeys(corpusRoot, '$.corpus', ['code', 'docs']);
  const corpus = {
    code: validateCorpusEntry(corpusRoot.code, '$.corpus.code'),
    docs: validateCorpusEntry(corpusRoot.docs, '$.corpus.docs'),
  };

  /** @type {WatchConfig} */
  const result = { repos, corpus };

  if (config.impact !== undefined) {
    result.impact = validateImpact(config.impact, '$.impact');
  }
  if (config.notify !== undefined) {
    const notify = requireObject(config.notify, '$.notify');
    rejectUnknownKeys(notify, '$.notify', ['targets']);
    if (!Array.isArray(notify.targets) || notify.targets.length === 0) {
      throw new ConfigError('$.notify.targets', 'se esperaba un array no vacío de destinos.');
    }
    result.notify = {
      targets: notify.targets.map((t, i) => validateNotifyTarget(t, `$.notify.targets[${i}]`)),
    };
  }
  return result;
};

/**
 * Carga y valida `karajan-watch.config.json` desde disco.
 *
 * @param {string} filePath
 * @returns {Promise<WatchConfig>}
 */
export const loadConfig = async (filePath) => {
  const raw = await readFile(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      '$',
      `JSON inválido en "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return validateConfig(parsed);
};
