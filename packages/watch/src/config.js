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
import {
  SENSITIVITY_LEVELS,
  DEFAULT_SENSITIVITY,
  validateSensitivityPolicy,
} from 'karajan-rag';
import { CONTRACT_TYPES } from './contracts.js';

/** Stores soportados por `karajan-rag index --store`. */
export const VALID_STORES = Object.freeze(['lancedb', 'pgvector', 'in-memory']);

/**
 * Con qué arranca un corpus que no declara nada: la vía sin servidor y sin
 * descargas. `lancedb` es un directorio en disco y `hash` no baja ningún
 * modelo, así que una instancia nueva no tiene que alojar ni descargar nada
 * antes de ver si la herramienta le sirve. Quien necesite más semántica sube
 * a `transformers`; quien comparta corpus entre máquinas, a `pgvector`.
 */
export const DEFAULT_CORPUS = Object.freeze({ store: 'lancedb', embedder: 'hash' });

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
 * @property {string} [group] Grupo al que pertenece el repo (clasificación libre de la instancia).
 * @property {{service: string, tier: string}} [dora] Clasificación DORA: servicio y tier del repo.
 *
 * @typedef {{prefix: string, level: Sensitivity}} SensitivityRule Sensibilidad por prefijo de ruta.
 *
 * @typedef {Object} CorpusConfig
 * @property {string} store Vector store de karajan-rag.
 * @property {string} embedder Embedder local de karajan-rag.
 * @property {Sensitivity} sensitivity Nivel de sensibilidad del corpus.
 * @property {SensitivityRule[]} [sensitivityRules] Solo corpus docs: sensibilidad por prefijo de ruta.
 *
 * @typedef {Object} ImpactThresholds
 * @property {number} [minSimilarity] Similitud mínima [0, 1] para considerar un candidato.
 * @property {number} [maxCandidates] Máximo de candidatos (entero >= 1).
 * @property {number} [inactivityDays] Umbral de inactividad de repos observados (entero >= 1, default 90) — KJW-TSK-0043.
 *
 * @typedef {{type: 'pr-comment'} | {type: 'webhook', url: string}} NotifyTarget
 *
 * @typedef {Object} WatchConfig
 * @property {RepoConfig[]} repos
 * @property {{code: CorpusConfig, docs: CorpusConfig}} corpus
 * @property {string[]} defaulted Valores asumidos por no venir declarados (`path = valor`), para que los pipelines los anuncien.
 * @property {{thresholds: ImpactThresholds}} [impact]
 * @property {{targets: NotifyTarget[]}} [notify]
 * @property {Record<Sensitivity, string[]>} [policy] Sensitivity policy propia (niveles → adapters); sin ella rige la default de karajan-rag.
 * @property {{enabled: boolean, types: string[]}} [contracts] Señal de contratos: qué tipos se minan. Sin la sección, la señal corre con todos los tipos.
 * @property {{enabled: boolean, dir?: string, retentionDays?: number}} [history] Persistencia de informes. Opt-in: sin la sección no se escribe nada.
 */

/**
 * Anuncia por log lo que el config no declaraba y se ha asumido. Un default
 * aplicado en silencio es indistinguible de un error: quien lee el informe
 * tiene derecho a saber con qué store y qué embedder se ha producido, sin
 * ir a buscarlo al código.
 *
 * @param {WatchConfig} config
 * @param {(msg: string) => void} log
 */
export const announceDefaults = (config, log) => {
  if (config.defaulted?.length) {
    log(`config: valores por defecto → ${config.defaulted.join(', ')}`);
  }
};

/**
 * @param {unknown} value
 * @param {string} path
 * @param {Set<string>} seenNames
 * @returns {RepoConfig}
 */
const validateRepo = (value, path, seenNames) => {
  const repo = requireObject(value, path);
  rejectUnknownKeys(repo, path, ['name', 'branch', 'sensitivity', 'group', 'dora']);
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
  /** @type {RepoConfig} */
  const result = { name, branch, sensitivity: /** @type {Sensitivity} */ (sensitivity) };
  if (repo.group !== undefined) {
    result.group = requireNonEmptyString(repo.group, `${path}.group`);
  }
  if (repo.dora !== undefined) {
    const dora = requireObject(repo.dora, `${path}.dora`);
    rejectUnknownKeys(dora, `${path}.dora`, ['service', 'tier']);
    result.dora = {
      service: requireNonEmptyString(dora.service, `${path}.dora.service`),
      tier: requireNonEmptyString(dora.tier, `${path}.dora.tier`),
    };
  }
  return result;
};

/**
 * Sensibilidad por prefijo del corpus docs; `level` fuera del vocabulario = error de carga.
 * @param {unknown} value
 * @param {string} path
 * @returns {SensitivityRule[]}
 */
const validateSensitivityRules = (value, path) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigError(path, 'se esperaba un array no vacío de reglas {prefix, level}.');
  }
  const seenPrefixes = new Set();
  return value.map((rule, i) => {
    const entry = requireObject(rule, `${path}[${i}]`);
    rejectUnknownKeys(entry, `${path}[${i}]`, ['prefix', 'level']);
    const prefix = requireNonEmptyString(entry.prefix, `${path}[${i}].prefix`);
    if (seenPrefixes.has(prefix)) {
      throw new ConfigError(`${path}[${i}].prefix`, `prefijo duplicado: "${prefix}".`);
    }
    seenPrefixes.add(prefix);
    const level = requireOneOf(entry.level, `${path}[${i}].level`, SENSITIVITY_LEVELS);
    return { prefix, level: /** @type {Sensitivity} */ (level) };
  });
};

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {CorpusConfig}
 */
const validateCorpusEntry = (value, path, defaulted, { allowSensitivityRules = false } = {}) => {
  const corpus = value === undefined ? {} : requireObject(value, path);
  const allowedKeys = allowSensitivityRules
    ? ['store', 'embedder', 'sensitivity', 'sensitivityRules']
    : ['store', 'embedder', 'sensitivity'];
  rejectUnknownKeys(corpus, path, allowedKeys);

  // Un hueco se rellena; un valor equivocado sigue fallando con su path. La
  // diferencia entre "no lo has dicho" y "lo has dicho mal" es justo lo que
  // no puede perderse al tener defaults.
  const withDefault = (raw, key, allowed, fallback) => {
    if (raw !== undefined) return requireOneOf(raw, `${path}.${key}`, allowed);
    defaulted.push(`${path}.${key} = ${fallback}`);
    return fallback;
  };

  /** @type {CorpusConfig} */
  const result = {
    store: withDefault(corpus.store, 'store', VALID_STORES, DEFAULT_CORPUS.store),
    embedder: withDefault(corpus.embedder, 'embedder', VALID_EMBEDDERS, DEFAULT_CORPUS.embedder),
    sensitivity: /** @type {Sensitivity} */ (
      withDefault(corpus.sensitivity, 'sensitivity', SENSITIVITY_LEVELS, DEFAULT_SENSITIVITY)
    ),
  };
  // Sin default: la ausencia de reglas no es un valor asumido — nada que anunciar en `defaulted`.
  if (corpus.sensitivityRules !== undefined) {
    result.sensitivityRules = validateSensitivityRules(
      corpus.sensitivityRules,
      `${path}.sensitivityRules`,
    );
  }
  return result;
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
  rejectUnknownKeys(thresholds, `${path}.thresholds`, ['minSimilarity', 'maxCandidates', 'inactivityDays']);
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
  if (thresholds.inactivityDays !== undefined) {
    const { inactivityDays } = thresholds;
    if (!Number.isInteger(inactivityDays) || /** @type {number} */ (inactivityDays) < 1) {
      throw new ConfigError(`${path}.thresholds.inactivityDays`, 'se esperaba un entero >= 1.');
    }
    result.inactivityDays = /** @type {number} */ (inactivityDays);
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
  rejectUnknownKeys(config, '$', [
    'repos',
    'corpus',
    'impact',
    'notify',
    'policy',
    'contracts',
    'history',
  ]);

  if (!Array.isArray(config.repos) || config.repos.length === 0) {
    throw new ConfigError('$.repos', 'se esperaba un array no vacío de repos.');
  }
  const seenNames = new Set();
  const repos = config.repos.map((repo, i) => validateRepo(repo, `$.repos[${i}]`, seenNames));

  // Declarar repos debería bastar para arrancar: el resto son decisiones que
  // se toman mal antes de haber visto la herramienta funcionar. Lo asumido se
  // acumula en `defaulted` y los pipelines lo anuncian — un default aplicado
  // en silencio es indistinguible de un error.
  /** @type {string[]} */
  const defaulted = [];
  const corpusRoot = config.corpus === undefined ? {} : requireObject(config.corpus, '$.corpus');
  rejectUnknownKeys(corpusRoot, '$.corpus', ['code', 'docs']);
  const corpus = {
    code: validateCorpusEntry(corpusRoot.code, '$.corpus.code', defaulted),
    docs: validateCorpusEntry(corpusRoot.docs, '$.corpus.docs', defaulted, {
      allowSensitivityRules: true,
    }),
  };

  /** @type {WatchConfig} */
  const result = { repos, corpus };
  // No enumerable a propósito: `defaulted` es metadato de la validación, no
  // configuración. Así ni se copia con un spread —revalidar un config ya
  // validado seguiría funcionando— ni se cuela en un JSON escrito a disco.
  Object.defineProperty(result, 'defaulted', { value: defaulted, enumerable: false });

  if (config.impact !== undefined) {
    result.impact = validateImpact(config.impact, '$.impact');
  }
  if (config.history !== undefined) {
    const history = requireObject(config.history, '$.history');
    rejectUnknownKeys(history, '$.history', ['enabled', 'dir', 'retentionDays']);
    /** @type {{enabled: boolean, dir?: string, retentionDays?: number}} */
    const parsed = { enabled: false };
    if (history.enabled !== undefined) {
      if (typeof history.enabled !== 'boolean') {
        throw new ConfigError('$.history.enabled', 'se esperaba un booleano.');
      }
      parsed.enabled = history.enabled;
    }
    if (history.dir !== undefined) {
      parsed.dir = requireNonEmptyString(history.dir, '$.history.dir');
    }
    if (history.retentionDays !== undefined) {
      const { retentionDays } = history;
      if (!Number.isInteger(retentionDays) || Number(retentionDays) < 1) {
        throw new ConfigError('$.history.retentionDays', 'se esperaba un entero >= 1.');
      }
      parsed.retentionDays = Number(retentionDays);
    }
    result.history = parsed;
  }

  if (config.contracts !== undefined) {
    const contracts = requireObject(config.contracts, '$.contracts');
    rejectUnknownKeys(contracts, '$.contracts', ['enabled', 'types']);
    /** @type {{enabled: boolean, types: string[]}} */
    const parsed = { enabled: true, types: [...CONTRACT_TYPES] };
    if (contracts.enabled !== undefined) {
      if (typeof contracts.enabled !== 'boolean') {
        throw new ConfigError('$.contracts.enabled', 'se esperaba un booleano.');
      }
      parsed.enabled = contracts.enabled;
    }
    if (contracts.types !== undefined) {
      if (!Array.isArray(contracts.types) || contracts.types.length === 0) {
        throw new ConfigError(
          '$.contracts.types',
          `se esperaba un array no vacío de: ${CONTRACT_TYPES.join(' | ')}.`,
        );
      }
      for (const type of contracts.types) {
        if (!CONTRACT_TYPES.includes(type)) {
          throw new ConfigError(
            '$.contracts.types',
            `tipo "${type}" desconocido (esperado: ${CONTRACT_TYPES.join(' | ')}).`,
          );
        }
      }
      parsed.types = [...contracts.types];
    }
    result.contracts = parsed;
  }
  if (config.policy !== undefined) {
    // La validación es del motor (DRY); solo se traduce el error al
    // formato de ConfigError con su path.
    try {
      result.policy = /** @type {WatchConfig['policy']} */ (
        validateSensitivityPolicy(config.policy)
      );
    } catch (err) {
      throw new ConfigError(
        '$.policy',
        err instanceof Error ? err.message : String(err),
        { cause: err },
      );
    }
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
