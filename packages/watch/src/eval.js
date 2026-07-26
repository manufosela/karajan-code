// @ts-check
/**
 * Eval del ranking de impacto con golden set de incidentes reales.
 *
 * Honestidad primero: la eval corre el pipeline con **señales puras**
 * (retrieval + co-cambios, sin juicio LLM y sin entrega) para que las
 * métricas sean reproducibles y baratas. Mide precision/recall@k del
 * ranking contra lo que realmente se vio afectado en incidentes pasados,
 * y actúa como gate: si el agregado cae bajo los umbrales declarados en
 * el propio golden, el comando falla.
 *
 * El golden set vive en el repo de despliegue de cada organización —
 * aquí solo el formato y la mecánica.
 */
import { readFile } from 'node:fs/promises';
import { runImpactPipeline } from './impact.js';

/** Error de golden set: formato inválido, con el path exacto de la clave. */
export class GoldenSetError extends Error {
  /**
   * @param {string} path
   * @param {string} detail
   * @param {{cause?: unknown}} [options]
   */
  constructor(path, detail, options) {
    super(`Golden set inválido en "${path}": ${detail}`, options);
    this.name = 'GoldenSetError';
    this.path = path;
  }
}

/**
 * @typedef {Object} GoldenCase
 * @property {string} name
 * @property {string} repoName Repo origen del incidente.
 * @property {string} diff Diff unificado del cambio que causó el incidente.
 * @property {string[]} expectedImpacted Ficheros (`repo/path`) que realmente se vieron afectados.
 *
 * @typedef {Object} GoldenThresholds
 * @property {number} [precision] Mínimo agregado exigido, en [0, 1].
 * @property {number} [recall] Mínimo agregado exigido, en [0, 1].
 * @property {number} [k] Corte del ranking a evaluar (default 10).
 *
 * @typedef {Object} GoldenSet
 * @property {GoldenThresholds} thresholds
 * @property {GoldenCase[]} cases
 *
 * @typedef {Object} CaseMetrics
 * @property {number} truePositives
 * @property {number} precision
 * @property {number} recall
 *
 * @typedef {Object} EvalReport
 * @property {{name: string, metrics: CaseMetrics}[]} cases
 * @property {{precision: number, recall: number}} aggregate Medias sobre los casos.
 * @property {boolean} passed
 */

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
const requireObject = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GoldenSetError(path, 'se esperaba un objeto.');
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
    throw new GoldenSetError(path, 'se esperaba un string no vacío.');
  }
  return value;
};

/**
 * Valida un golden set. Estricto: clave desconocida = error con path.
 *
 * @param {unknown} raw
 * @returns {GoldenSet}
 */
export const validateGoldenSet = (raw) => {
  const golden = requireObject(raw, '$');
  for (const key of Object.keys(golden)) {
    if (!['thresholds', 'cases'].includes(key)) {
      throw new GoldenSetError(`$.${key}`, 'clave desconocida.');
    }
  }

  const thresholdsRaw = requireObject(golden.thresholds ?? {}, '$.thresholds');
  /** @type {GoldenThresholds} */
  const thresholds = {};
  for (const key of Object.keys(thresholdsRaw)) {
    if (!['precision', 'recall', 'k'].includes(key)) {
      throw new GoldenSetError(`$.thresholds.${key}`, 'clave desconocida.');
    }
  }
  for (const metric of /** @type {const} */ (['precision', 'recall'])) {
    const value = thresholdsRaw[metric];
    if (value !== undefined) {
      if (typeof value !== 'number' || value < 0 || value > 1) {
        throw new GoldenSetError(`$.thresholds.${metric}`, 'se esperaba un número en [0, 1].');
      }
      thresholds[metric] = value;
    }
  }
  if (thresholdsRaw.k !== undefined) {
    if (!Number.isInteger(thresholdsRaw.k) || /** @type {number} */ (thresholdsRaw.k) < 1) {
      throw new GoldenSetError('$.thresholds.k', 'se esperaba un entero >= 1.');
    }
    thresholds.k = /** @type {number} */ (thresholdsRaw.k);
  }

  if (!Array.isArray(golden.cases) || golden.cases.length === 0) {
    throw new GoldenSetError('$.cases', 'se esperaba un array no vacío de casos.');
  }
  const cases = golden.cases.map((rawCase, i) => {
    const path = `$.cases[${i}]`;
    const goldenCase = requireObject(rawCase, path);
    for (const key of Object.keys(goldenCase)) {
      if (!['name', 'repoName', 'diff', 'expectedImpacted'].includes(key)) {
        throw new GoldenSetError(`${path}.${key}`, 'clave desconocida.');
      }
    }
    const name = requireNonEmptyString(goldenCase.name, `${path}.name`);
    const repoName = requireNonEmptyString(goldenCase.repoName, `${path}.repoName`);
    const diff = requireNonEmptyString(goldenCase.diff, `${path}.diff`);
    if (
      !Array.isArray(goldenCase.expectedImpacted) ||
      goldenCase.expectedImpacted.length === 0 ||
      !goldenCase.expectedImpacted.every((s) => typeof s === 'string' && s.length > 0)
    ) {
      throw new GoldenSetError(
        `${path}.expectedImpacted`,
        'se esperaba un array no vacío de paths `repo/…`.',
      );
    }
    return { name, repoName, diff, expectedImpacted: goldenCase.expectedImpacted };
  });

  return { thresholds, cases };
};

/**
 * Métricas de un ranking contra lo esperado.
 *
 * precision@k = aciertos / devueltos (hasta k); recall@k = aciertos / esperados.
 *
 * @param {{source: string}[]} ranking
 * @param {string[]} expectedImpacted
 * @param {number} k
 * @returns {CaseMetrics}
 */
export const evaluateRanking = (ranking, expectedImpacted, k) => {
  const returned = ranking.slice(0, k).map((entry) => entry.source);
  const expected = new Set(expectedImpacted);
  const truePositives = returned.filter((source) => expected.has(source)).length;
  return {
    truePositives,
    precision: returned.length === 0 ? 0 : truePositives / returned.length,
    recall: truePositives / expected.size,
  };
};

/**
 * Ejecuta la eval completa: pipeline por caso (señales puras) + gate.
 *
 * @param {Object} params
 * @param {GoldenSet} params.golden
 * @param {import('./config.js').WatchConfig} params.config
 * @param {string} params.workspaceDir
 * @param {Record<string, string | undefined>} [params.env]
 * @param {import('./impact.js').ImpactDeps} [params.deps]
 * @returns {Promise<EvalReport>}
 */
export const runGoldenEval = async ({ golden, config, workspaceDir, env, deps }) => {
  const k = golden.thresholds.k ?? 10;
  /** @type {EvalReport['cases']} */
  const cases = [];
  for (const goldenCase of golden.cases) {
    const { ranking } = await runImpactPipeline({
      config,
      workspaceDir,
      repoName: goldenCase.repoName,
      diffText: goldenCase.diff,
      judge: false,
      deliver: false,
      env,
      deps,
    });
    cases.push({
      name: goldenCase.name,
      metrics: evaluateRanking(ranking, goldenCase.expectedImpacted, k),
    });
  }

  const mean = (/** @type {(c: EvalReport['cases'][0]) => number} */ pick) =>
    cases.reduce((sum, c) => sum + pick(c), 0) / cases.length;
  const aggregate = {
    precision: mean((c) => c.metrics.precision),
    recall: mean((c) => c.metrics.recall),
  };

  const { precision, recall } = golden.thresholds;
  const passed =
    (precision === undefined || aggregate.precision >= precision) &&
    (recall === undefined || aggregate.recall >= recall);

  return { cases, aggregate, passed };
};

/**
 * Carga y valida un golden set desde disco.
 *
 * @param {string} filePath
 * @returns {Promise<GoldenSet>}
 */
export const loadGoldenSet = async (filePath) => {
  const raw = await readFile(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new GoldenSetError(
      '$',
      `JSON inválido en "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return validateGoldenSet(parsed);
};
