// @ts-check
/**
 * Métricas locales de evaluación RAG (roadmap 0.4.0).
 *
 * Variantes léxico-deterministas sin LLM, embeddings ni frameworks
 * externos: aproximaciones por solape de tokens de contenido (mismo
 * espíritu que `estimateTokens` — suficientes para baselines offline y
 * CI, no sustituyen a una evaluación semántica). Reutilizan el
 * `tokenize` de BM25 y filtran stopwords/interrogativos comunes
 * es/en para que las palabras función no inflen los scores.
 *
 * Todas devuelven valores en [0, 1] y las entradas degeneradas tienen
 * semántica definida (nunca NaN):
 * - respuesta vacía o sin tokens de contenido → 0.
 * - contextos vacíos → faithfulness 0.
 * - pregunta sin tokens de contenido → answerRelevance 0.
 * - `relevantIds` vacío en contextRecall → error explícito (el golden
 *   set debe declarar qué es relevante; no hay recall sin referencia).
 */
import { tokenize } from '../retrieval/bm25.js';

/** Palabras función + interrogativos (es/en) excluidos del contenido. */
const STOPWORDS = new Set([
  // es — artículos, preposiciones, clíticos frecuentes
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'al', 'del',
  'de', 'en', 'a', 'y', 'o', 'u', 'e', 'que', 'se', 'su', 'sus', 'es', 'son',
  'por', 'para', 'con', 'sin', 'no', 'si', 'ya', 'mas', 'muy', 'este', 'esta',
  'ese', 'esa', 'cada',
  // es — interrogativos (relevance compara contenido, no la forma de preguntar)
  'cuando', 'como', 'donde', 'quien', 'quienes', 'cual', 'cuales', 'cuanto',
  'cuanta', 'cuantos', 'cuantas', 'porque',
  // en
  'the', 'a', 'an', 'of', 'in', 'on', 'is', 'are', 'to', 'and', 'or', 'it',
  'this', 'that', 'for', 'with', 'what', 'when', 'where', 'who', 'how', 'why',
]);

/**
 * Tokens de contenido únicos de un texto.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function contentTokens(text) {
  return new Set(tokenize(text).filter((t) => !STOPWORDS.has(t)));
}

/**
 * Proporción de `tokens` presentes en `reference`. Ambos no vacíos.
 *
 * @param {Set<string>} tokens
 * @param {Set<string>} reference
 * @returns {number}
 */
function coverage(tokens, reference) {
  let hits = 0;
  for (const token of tokens) if (reference.has(token)) hits += 1;
  return hits / tokens.size;
}

/**
 * Faithfulness: ¿qué fracción del contenido de la respuesta está
 * respaldada por los contextos? 1 = todo aparece en el contexto,
 * 0 = alucinación total (o entradas vacías).
 *
 * @param {string} answer
 * @param {string[]} contexts
 * @returns {number}
 */
export function faithfulness(answer, contexts) {
  const answerTokens = contentTokens(answer);
  const contextTokens = contentTokens((contexts ?? []).join(' '));
  if (answerTokens.size === 0 || contextTokens.size === 0) return 0;
  return coverage(answerTokens, contextTokens);
}

/**
 * Context precision: fracción de los pasajes recuperados que son
 * relevantes según la referencia. Recuperados vacíos → 0.
 *
 * @param {string[]} retrievedIds
 * @param {string[]} relevantIds
 * @returns {number}
 */
export function contextPrecision(retrievedIds, relevantIds) {
  const retrieved = [...new Set(retrievedIds ?? [])];
  if (retrieved.length === 0) return 0;
  const relevant = new Set(relevantIds ?? []);
  const hits = retrieved.filter((id) => relevant.has(id)).length;
  return hits / retrieved.length;
}

/**
 * Context recall: fracción de los pasajes relevantes que fueron
 * recuperados. La referencia es obligatoria.
 *
 * @param {string[]} retrievedIds
 * @param {string[]} relevantIds
 * @returns {number}
 */
export function contextRecall(retrievedIds, relevantIds) {
  const relevant = [...new Set(relevantIds ?? [])];
  if (relevant.length === 0) {
    throw new Error(
      'contextRecall: "relevantIds" no puede estar vacío — el golden set debe declarar los pasajes relevantes.',
    );
  }
  const retrieved = new Set(retrievedIds ?? []);
  const hits = relevant.filter((id) => retrieved.has(id)).length;
  return hits / relevant.length;
}

/**
 * Answer relevance: ¿la respuesta cubre el contenido de la pregunta?
 * Cobertura de los tokens de contenido de la pregunta en la respuesta
 * (los interrogativos no cuentan como contenido). Los duplicados en la
 * respuesta no suman: se mide sobre tokens únicos.
 *
 * @param {string} question
 * @param {string} answer
 * @returns {number}
 */
export function answerRelevance(question, answer) {
  const questionTokens = contentTokens(question);
  const answerTokens = contentTokens(answer);
  if (questionTokens.size === 0 || answerTokens.size === 0) return 0;
  return coverage(questionTokens, answerTokens);
}

/**
 * @typedef {object} LocalMetricsReport
 * @property {number} faithfulness
 * @property {number | null} contextPrecision null si no se pasaron ids.
 * @property {number | null} contextRecall null si no se pasaron ids.
 * @property {number} answerRelevance
 */

/**
 * Calcula las cuatro métricas de una respuesta. Los ids de retrieval son
 * opcionales: sin ellos solo se calculan las métricas de texto.
 *
 * @param {{
 *   question: string,
 *   answer: string,
 *   contexts: string[],
 *   retrievedIds?: string[],
 *   relevantIds?: string[],
 * }} input
 * @returns {LocalMetricsReport}
 */
export function evaluateAnswer(input) {
  const hasIds = Array.isArray(input.retrievedIds) && Array.isArray(input.relevantIds);
  return {
    faithfulness: faithfulness(input.answer, input.contexts),
    contextPrecision: hasIds
      ? contextPrecision(/** @type {string[]} */ (input.retrievedIds), /** @type {string[]} */ (input.relevantIds))
      : null,
    contextRecall: hasIds
      ? contextRecall(/** @type {string[]} */ (input.retrievedIds), /** @type {string[]} */ (input.relevantIds))
      : null,
    answerRelevance: answerRelevance(input.question, input.answer),
  };
}
