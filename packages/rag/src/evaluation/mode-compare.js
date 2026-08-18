// @ts-check
/**
 * Comparativa offline CAG vs RAG sobre un golden set (KJR-TSK-0144,
 * épica CAG). Sin LLM: mide lo que se puede medir honestamente en local —
 *
 *   - RAG: ¿el top-k encuentra las fuentes relevantes? (recall por caso)
 *     y ¿cuánto contexto viaja por consulta? (chars del top-k)
 *   - CAG: recall 1.0 trivial (el modelo ve todo) al precio de enviar el
 *     corpus completo en cada consulta — si es que cabe en el presupuesto.
 *
 * La salida es una recomendación heurística con sus números delante:
 * decidir modo con datos, no a ojo. La calidad de la RESPUESTA final
 * sigue necesitando jueces (eval --judges) — esto compara retrieval y
 * coste, y lo dice.
 */
import path from 'node:path';
import { createHashEmbedder } from '../embedding/embedder.js';
import { InMemoryVectorStore } from '../vector-store/in-memory-vector-store.js';
import { indexDirectory } from '../easy/indexer.js';
import { queryIndex } from '../easy/query.js';
import { buildCagContext, DEFAULT_CAG_MAX_CHARS } from '../easy/cag.js';

/**
 * @typedef {object} ModeCaseComparison
 * @property {string} id
 * @property {number} ragRecall Fracción de relevantSources presentes en el top-k.
 * @property {number} ragChars Contexto que viaja en RAG (chars del top-k).
 * @property {number} costRatio cagChars / ragChars (Infinity si RAG no recuperó nada).
 *
 * @typedef {object} ModeComparisonReport
 * @property {boolean} cagFits El corpus cabe en el presupuesto CAG.
 * @property {number} cagChars Tamaño real del corpus completo.
 * @property {number} cagBudget Presupuesto aplicado.
 * @property {ModeCaseComparison[]} perCase
 * @property {{ ragRecall: number, avgRagChars: number, avgCostRatio: number }} aggregates
 * @property {'rag' | 'cag'} recommendedMode
 * @property {string} recommendation Justificación con números.
 */

/**
 * Compara ambos modos sobre el golden set, offline y determinista.
 *
 * @param {import('./golden-runner.js').GoldenSet} golden
 * @param {{ corpusDir: string, dimensions?: number, cagMaxChars?: number }} options
 * @returns {Promise<ModeComparisonReport>}
 */
export async function compareModes(golden, options) {
  const topK = golden.topK ?? 3;
  const dimensions = options.dimensions ?? 64;
  const cagBudget = options.cagMaxChars ?? DEFAULT_CAG_MAX_CHARS;

  const embedder = createHashEmbedder({ dimensions });
  const store = new InMemoryVectorStore({ dimensions });
  await indexDirectory(options.corpusDir, { store, embedder });

  // Tamaño real del corpus: se mide SIEMPRE (presupuesto sin límite) y el
  // veredicto de si cabe se decide contra el presupuesto pedido.
  const cag = await buildCagContext(options.corpusDir, { maxChars: Number.MAX_SAFE_INTEGER });
  const cagFits = cag.chars <= cagBudget;

  /** @type {ModeCaseComparison[]} */
  const perCase = [];
  for (const item of golden.cases) {
    const { hits } = await queryIndex(item.question, {
      rootDir: options.corpusDir,
      store: /** @type {never} */ (store),
      embedder,
      topK,
    });
    const retrieved = new Set(hits.map((h) => path.basename(h.source)));
    const found = item.relevantSources.filter((s) => retrieved.has(path.basename(s))).length;
    const ragChars = hits.reduce((sum, h) => sum + h.content.length, 0);
    perCase.push({
      id: item.id,
      ragRecall: found / item.relevantSources.length,
      ragChars,
      costRatio: ragChars > 0 ? cag.chars / ragChars : Number.POSITIVE_INFINITY,
    });
  }

  const ragRecall = perCase.reduce((s, c) => s + c.ragRecall, 0) / perCase.length;
  const avgRagChars = perCase.reduce((s, c) => s + c.ragChars, 0) / perCase.length;
  const finiteRatios = perCase.filter((c) => Number.isFinite(c.costRatio));
  const avgCostRatio = finiteRatios.length > 0
    ? finiteRatios.reduce((s, c) => s + c.costRatio, 0) / finiteRatios.length
    : Number.POSITIVE_INFINITY;

  /** @type {'rag' | 'cag'} */
  let recommendedMode;
  let recommendation;
  if (!cagFits) {
    recommendedMode = 'rag';
    recommendation =
      `rag: el corpus ocupa ${cag.chars} chars y el presupuesto CAG es ${cagBudget} — ` +
      'CAG no es viable sin subir --max-context-chars (y el coste por consulta que implica).';
  } else if (ragRecall >= 0.95) {
    recommendedMode = 'rag';
    recommendation =
      `rag: el retrieval ya encuentra las fuentes relevantes (recall ${ragRecall.toFixed(2)}) ` +
      `con ~${Math.round(avgCostRatio)}x menos contexto por consulta que CAG (${cag.chars} chars).`;
  } else {
    recommendedMode = 'cag';
    recommendation =
      `cag: el recall del retrieval es ${ragRecall.toFixed(2)} (se pierden fuentes relevantes) y el ` +
      `corpus cabe en el presupuesto (${cag.chars}/${cagBudget} chars). CAG garantiza que el modelo ` +
      `lo ve todo a ~${Math.round(avgCostRatio)}x más contexto por consulta. La calidad de la ` +
      'respuesta final confírmala con eval --judges.';
  }

  return {
    cagFits,
    cagChars: cag.chars,
    cagBudget,
    perCase,
    aggregates: { ragRecall, avgRagChars, avgCostRatio },
    recommendedMode,
    recommendation,
  };
}
