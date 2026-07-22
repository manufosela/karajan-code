// @ts-check
/**
 * Runner del golden set (roadmap 0.4.0).
 *
 * Ejecuta un golden set offline con stubs deterministas: indexa el
 * corpus (HashEmbedder + InMemoryVectorStore), lanza cada pregunta con
 * el retrieval híbrido de la capa easy y calcula las métricas locales.
 * Compara las medias agregadas contra el baseline declarado en el
 * propio golden.json: cualquier media por debajo del mínimo hace fallar
 * el run señalando métrica y peores casos.
 *
 * A nivel de fichero, no de chunk: `relevantSources` del golden declara
 * qué documentos deben aparecer en el top-k (precision/recall sobre
 * `source`), y faithfulness mide si el contenido recuperado respalda la
 * respuesta esperada.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHashEmbedder } from '../embedding/embedder.js';
import { InMemoryVectorStore } from '../vector-store/in-memory-vector-store.js';
import { indexDirectory } from '../easy/indexer.js';
import { queryIndex } from '../easy/query.js';
import { evaluateAnswer } from './local-metrics.js';

/**
 * @typedef {object} GoldenCase
 * @property {string} id
 * @property {string} question
 * @property {string} expectedAnswer
 * @property {string[]} relevantSources
 *
 * @typedef {object} GoldenSet
 * @property {number} [topK]
 * @property {Record<string, number>} baseline Mínimos por métrica.
 * @property {GoldenCase[]} cases
 *
 * @typedef {object} GoldenCaseResult
 * @property {string} id
 * @property {string[]} retrievedSources
 * @property {import('./local-metrics.js').LocalMetricsReport} metrics
 *
 * @typedef {object} GoldenRunReport
 * @property {boolean} passed
 * @property {Record<string, number>} aggregates Media por métrica.
 * @property {{ metric: string, value: number, minimum: number, worstCases: string[] }[]} failures
 * @property {GoldenCaseResult[]} results
 */

const METRICS = Object.freeze(['faithfulness', 'contextPrecision', 'contextRecall', 'answerRelevance']);

/**
 * Valida la forma mínima del golden set.
 *
 * @param {unknown} value
 * @returns {GoldenSet}
 */
export function validateGoldenSet(value) {
  const golden = /** @type {GoldenSet} */ (value);
  const valid =
    golden !== null &&
    typeof golden === 'object' &&
    golden.baseline !== null &&
    typeof golden.baseline === 'object' &&
    Array.isArray(golden.cases) &&
    golden.cases.length > 0;
  if (!valid) {
    throw new Error('golden set inválido: se requieren "baseline" (objeto) y "cases" (array no vacío).');
  }
  for (const [metric, minimum] of Object.entries(golden.baseline)) {
    if (!METRICS.includes(metric) || typeof minimum !== 'number' || minimum < 0 || minimum > 1) {
      throw new Error(
        `golden set inválido: baseline."${metric}" debe ser una métrica conocida (${METRICS.join(', ')}) con mínimo en [0,1].`,
      );
    }
  }
  for (const item of golden.cases) {
    if (!item.id || !item.question || !item.expectedAnswer || !Array.isArray(item.relevantSources) || item.relevantSources.length === 0) {
      throw new Error(
        `golden set inválido: cada case requiere id, question, expectedAnswer y relevantSources no vacío (falla: ${JSON.stringify(item.id ?? item)}).`,
      );
    }
  }
  return golden;
}

/**
 * Carga y valida un golden.json.
 *
 * @param {string} goldenPath
 * @returns {Promise<GoldenSet>}
 */
export async function loadGoldenSet(goldenPath) {
  const raw = await readFile(goldenPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`golden set ilegible (JSON inválido): ${goldenPath}`);
  }
  return validateGoldenSet(parsed);
}

/**
 * Ejecuta el golden set contra un corpus con stubs deterministas.
 *
 * @param {GoldenSet} golden
 * @param {{ corpusDir: string, dimensions?: number }} options
 * @returns {Promise<GoldenRunReport>}
 */
export async function runGoldenSet(golden, options) {
  const topK = golden.topK ?? 3;
  const dimensions = options.dimensions ?? 64;
  const embedder = createHashEmbedder({ dimensions });
  const store = new InMemoryVectorStore({ dimensions });
  await indexDirectory(options.corpusDir, { store, embedder });

  /** @type {GoldenCaseResult[]} */
  const results = [];
  for (const item of golden.cases) {
    const { hits } = await queryIndex(item.question, {
      rootDir: options.corpusDir,
      store: /** @type {never} */ (store),
      embedder,
      topK,
    });
    const retrievedSources = [...new Set(hits.map((h) => path.basename(h.source)))];
    const metrics = evaluateAnswer({
      question: item.question,
      answer: item.expectedAnswer,
      contexts: hits.map((h) => h.content),
      retrievedIds: retrievedSources,
      relevantIds: item.relevantSources,
    });
    results.push({ id: item.id, retrievedSources, metrics });
  }

  /** @type {Record<string, number>} */
  const aggregates = {};
  for (const metric of METRICS) {
    const values = results
      .map((r) => /** @type {Record<string, number | null>} */ (r.metrics)[metric])
      .filter(/** @returns {v is number} */ (v) => typeof v === 'number');
    if (values.length > 0) {
      aggregates[metric] = values.reduce((s, v) => s + v, 0) / values.length;
    }
  }

  /** @type {GoldenRunReport['failures']} */
  const failures = [];
  for (const [metric, minimum] of Object.entries(golden.baseline)) {
    const value = aggregates[metric];
    if (typeof value !== 'number' || value < minimum) {
      const worstCases = [...results]
        .sort(
          (a, b) =>
            (/** @type {any} */ (a.metrics)[metric] ?? 0) - (/** @type {any} */ (b.metrics)[metric] ?? 0),
        )
        .slice(0, 3)
        .map((r) => r.id);
      failures.push({ metric, value: value ?? 0, minimum, worstCases });
    }
  }

  return { passed: failures.length === 0, aggregates, failures, results };
}
