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
 * @property {string} [mergedAt] Fecha ISO del merge del caso (KJW-TSK-0042) — permite avisar cuando el índice es anterior al cambio.
 * @property {string[]} [expectedRepos] Repos realmente afectados (KJW-TSK-0042) — la métrica que no castiga ficheros creados DESPUÉS de indexar.
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
 * @property {{name: string, metrics: CaseMetrics, repoMetrics?: CaseMetrics}[]} cases
 * @property {{precision: number, recall: number, repoPrecision?: number, repoRecall?: number}} aggregate Medias sobre los casos (las de repo, solo sobre los casos que declaran expectedRepos).
 * @property {boolean} passed
 * @property {string[]} warnings Avisos de medición (KJW-TSK-0042): p.ej. índice anterior al merge de un caso — el número se da, pero jamás en silencio.
 * @property {{store: string, embedder: string, corpusIndexedAt?: string}} measuredWith Con qué se obtuvieron estos números: los scores NO son comparables entre backends, así que un umbral calibrado aquí no vale para otro store.
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
      if (!['name', 'repoName', 'diff', 'expectedImpacted', 'mergedAt', 'expectedRepos'].includes(key)) {
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
    /** @type {GoldenCase} */
    const result = { name, repoName, diff, expectedImpacted: goldenCase.expectedImpacted };
    if (goldenCase.mergedAt !== undefined) {
      const mergedAt = requireNonEmptyString(goldenCase.mergedAt, `${path}.mergedAt`);
      if (Number.isNaN(Date.parse(mergedAt))) {
        throw new GoldenSetError(`${path}.mergedAt`, 'se esperaba una fecha ISO parseable.');
      }
      result.mergedAt = mergedAt;
    }
    if (goldenCase.expectedRepos !== undefined) {
      if (
        !Array.isArray(goldenCase.expectedRepos) ||
        goldenCase.expectedRepos.length === 0 ||
        !goldenCase.expectedRepos.every((s) => typeof s === 'string' && s.length > 0)
      ) {
        throw new GoldenSetError(`${path}.expectedRepos`, 'se esperaba un array no vacío de repos.');
      }
      result.expectedRepos = goldenCase.expectedRepos;
    }
    return result;
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
 * Métricas a nivel de REPO (KJW-TSK-0042): ¿acertó QUÉ repos se ven
 * afectados? Es la métrica que refleja lo que el juicio sabe hacer cuando
 * los ficheros correctos ni existían al indexar (caso real: repo 2/2 donde
 * fichero daba 0 — un cero que no era de la herramienta).
 *
 * @param {{repo: string}[]} ranking
 * @param {string[]} expectedRepos
 * @param {number} k
 * @returns {CaseMetrics}
 */
export const evaluateRepoRanking = (ranking, expectedRepos, k) => {
  const returned = [...new Set(ranking.slice(0, k).map((entry) => entry.repo))];
  const expected = new Set(expectedRepos);
  const truePositives = returned.filter((repo) => expected.has(repo)).length;
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
 * @param {string} [params.corpusIndexedAt] Fecha ISO en que se indexó el corpus (KJW-TSK-0042): un caso cuyo merge es POSTERIOR se mide contra un mundo que no lo conocía — se avisa, nunca se puntúa en silencio.
 * @param {Record<string, string | undefined>} [params.env]
 * @param {import('./impact.js').ImpactDeps} [params.deps]
 * @returns {Promise<EvalReport>}
 */
export const runGoldenEval = async ({ golden, config, workspaceDir, corpusIndexedAt, env, deps }) => {
  const k = golden.thresholds.k ?? 10;
  /** @type {EvalReport['cases']} */
  const cases = [];
  /** @type {string[]} */
  const warnings = [];
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
    /** @type {EvalReport['cases'][0]} */
    const entry = {
      name: goldenCase.name,
      metrics: evaluateRanking(ranking, goldenCase.expectedImpacted, k),
    };
    if (goldenCase.expectedRepos) {
      entry.repoMetrics = evaluateRepoRanking(ranking, goldenCase.expectedRepos, k);
    }
    if (
      corpusIndexedAt &&
      goldenCase.mergedAt &&
      Date.parse(corpusIndexedAt) < Date.parse(goldenCase.mergedAt)
    ) {
      warnings.push(
        `caso "${goldenCase.name}": el índice (${corpusIndexedAt}) es anterior al merge ` +
          `(${goldenCase.mergedAt}) — la métrica de fichero castiga ficheros que no existían al indexar; ` +
          'mira la métrica de repo.',
      );
    }
    cases.push(entry);
  }

  const mean = (/** @type {(c: EvalReport['cases'][0]) => number} */ pick) =>
    cases.reduce((sum, c) => sum + pick(c), 0) / cases.length;
  /** @type {EvalReport['aggregate']} */
  const aggregate = {
    precision: mean((c) => c.metrics.precision),
    recall: mean((c) => c.metrics.recall),
  };
  const withRepos = cases.filter((c) => c.repoMetrics);
  if (withRepos.length > 0) {
    aggregate.repoPrecision =
      withRepos.reduce((s, c) => s + (c.repoMetrics?.precision ?? 0), 0) / withRepos.length;
    aggregate.repoRecall =
      withRepos.reduce((s, c) => s + (c.repoMetrics?.recall ?? 0), 0) / withRepos.length;
  }

  const { precision, recall } = golden.thresholds;
  const passed =
    (precision === undefined || aggregate.precision >= precision) &&
    (recall === undefined || aggregate.recall >= recall);

  // Los scores no son comparables entre backends (KJR-PRP-0010): unos
  // umbrales calibrados con un store y un embedder no significan lo mismo
  // con otros. El informe lo deja registrado en vez de dar un número suelto.
  const { store, embedder } = config.corpus.code;
  /** @type {EvalReport['measuredWith']} */
  const measuredWith = { store, embedder };
  if (corpusIndexedAt) measuredWith.corpusIndexedAt = corpusIndexedAt;
  return { cases, aggregate, passed, warnings, measuredWith };
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
