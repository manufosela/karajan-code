// @ts-check

/**
 * @typedef {import('../ai/types.js').AdapterResult} AdapterResult
 * @typedef {import('../ai/adapter-registry.js').AdapterRegistry} AdapterRegistry
 */

/**
 * @typedef {Object} JudgeVerdict
 * @property {string} provider Juez que emitió el veredicto.
 * @property {number | null} score [0,1] o null si el juez no devolvió parseable.
 * @property {string | null} rationale Breve justificación si el juez la devuelve.
 * @property {string | null} error Mensaje si el juez falló completamente.
 * @property {'consensus' | 'outlier' | null} label Auto-labelling: outlier si se
 *   desvía de la mediana >= threshold; null si el score no es parseable.
 * @property {number | null} deviation |score - mediana| o null sin score.
 */

/**
 * @typedef {Object} EvaluationReport
 * @property {number | null} aggregateScore Promedio de los scores válidos.
 * @property {boolean} disagreement true si la desviación entre jueces >= threshold.
 * @property {string[]} outliers Providers etiquetados como outlier.
 * @property {JudgeVerdict[]} verdicts
 */

/**
 * Construye el prompt estándar para el LLM-as-judge.
 *
 * @param {{ query: string, answer: string, context?: string }} input
 * @returns {string}
 */
export function buildJudgePrompt(input) {
  const ctx = input.context ? `Contexto:\n${input.context}\n` : '';
  return [
    'Actúas como juez de calidad RAG. Evalúa la respuesta frente al contexto y la pregunta.',
    '',
    `Pregunta: ${input.query}`,
    ctx,
    `Respuesta: ${input.answer}`,
    '',
    'Devuelve EXCLUSIVAMENTE un JSON:',
    '{ "score": <numero entre 0 y 1>, "rationale": "<una frase>" }',
    'score=1 significa perfectamente fundamentada en el contexto; score=0 significa alucinación total.',
  ].join('\n');
}

/**
 * @param {AdapterResult | null | undefined} result
 * @returns {{ score: number | null, rationale: string | null }}
 */
function extractScore(result) {
  const json = result?.parsedOutput?.json;
  if (json && typeof json === 'object') {
    const obj = /** @type {any} */ (json);
    const score = typeof obj.score === 'number' ? Math.max(0, Math.min(1, obj.score)) : null;
    const rationale = typeof obj.rationale === 'string' ? obj.rationale : null;
    return { score, rationale };
  }
  return { score: null, rationale: null };
}

/**
 * Evalúa groundedness de una respuesta usando múltiples CLIs como jueces.
 *
 * @param {{
 *   registry: AdapterRegistry,
 *   providers: string[],
 *   input: { query: string, answer: string, context?: string },
 *   disagreementThreshold?: number,
 * }} params
 * @returns {Promise<EvaluationReport>}
 */
export async function evaluateMultiJudge(params) {
  const { registry, providers, input } = params;
  const threshold = params.disagreementThreshold ?? 0.3;
  if (!registry || typeof registry.get !== 'function') {
    throw new Error('evaluateMultiJudge: registry requerido.');
  }
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new Error('evaluateMultiJudge: providers array no vacío requerido.');
  }
  const prompt = buildJudgePrompt(input);

  const settled = await Promise.allSettled(
    providers.map((name) => registry.get(name)(prompt)),
  );

  /** @type {JudgeVerdict[]} */
  const verdicts = settled.map((outcome, i) => {
    const provider = providers[i];
    if (outcome.status === 'rejected') {
      return {
        provider,
        score: null,
        rationale: null,
        error:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason ?? 'unknown'),
        label: null,
        deviation: null,
      };
    }
    const { score, rationale } = extractScore(/** @type {AdapterResult} */ (outcome.value));
    return { provider, score, rationale, error: null, label: null, deviation: null };
  });

  const scores = verdicts
    .map((v) => v.score)
    .filter(/** @returns {n is number} */ (n) => typeof n === 'number');

  if (scores.length === 0) {
    return { aggregateScore: null, disagreement: false, outliers: [], verdicts };
  }

  // Auto-labelling (roadmap 0.4.0): outlier = se desvía de la mediana >=
  // threshold. La mediana es más robusta que la media como "consenso"
  // (un solo juez desviado no la arrastra). Con dos jueces enfrentados no
  // hay consenso posible: ambos quedan etiquetados como outlier.
  const sorted = [...scores].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  /** @type {string[]} */
  const outliers = [];
  for (const verdict of verdicts) {
    if (typeof verdict.score !== 'number') continue;
    verdict.deviation = Math.abs(verdict.score - median);
    verdict.label = verdict.deviation >= threshold ? 'outlier' : 'consensus';
    if (verdict.label === 'outlier') outliers.push(verdict.provider);
  }

  const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  return {
    aggregateScore: avg,
    disagreement: max - min >= threshold,
    outliers,
    verdicts,
  };
}
