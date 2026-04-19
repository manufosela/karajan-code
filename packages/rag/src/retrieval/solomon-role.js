// @ts-check
import { Role } from '../pipeline/role.js';

/**
 * @typedef {import('../vector-store/in-memory-vector-store.js').SearchHit} SearchHit
 * @typedef {import('../pipeline/types.js').ToolBox} ToolBox
 * @typedef {import('../pipeline/types.js').Logger} Logger
 */

/**
 * @typedef {Object} SolomonSourceResult
 * @property {string} source Identificador del corpus (p.ej. "docs", "policies", "chat-history").
 * @property {SearchHit[]} hits Top-k local de ese source.
 */

/**
 * @typedef {Object} SolomonInput
 * @property {string} query Query original del usuario.
 * @property {SolomonSourceResult[]} sourceResults Retrievals paralelos por source.
 * @property {number} [maxChunks] Máximo global de chunks a devolver tras arbitraje.
 */

/**
 * @typedef {Object} SolomonVerdict
 * @property {SearchHit[]} chunks Chunks finales ordenados por relevancia global.
 * @property {string} rationale Una línea explicando la decisión.
 * @property {Record<string, number>} sourceWeights Peso aplicado a cada source en la mezcla.
 * @property {'majority'|'weighted'|'llm-arbiter'} strategy Estrategia que produjo el verdict.
 */

/**
 * @typedef {(input: { query: string, candidates: SearchHit[], sources: string[] }) =>
 *   Promise<{ chunks: SearchHit[], rationale?: string }>} SolomonArbiter
 */

/**
 * @typedef {'majority'|'weighted'|'llm-arbiter'} SolomonStrategy
 */

/**
 * SolomonRole — arbitraje multi-source de retrievals.
 *
 * Recibe retrievals ya calculados (no paraleliza internamente) y los combina
 * según la estrategia configurada:
 *
 * - **majority**: un chunk que aparezca en N sources recibe score sumado y
 *   bonus por co-ocurrencia (factor N). Robusto ante ruido de un único source.
 * - **weighted**: combinación lineal `score * sourceWeights[source]`. Útil
 *   cuando se sabe a priori que ciertas fuentes son más fiables.
 * - **llm-arbiter**: delega a un callback externo (LLM, reranker, lógica
 *   de negocio). El callback recibe candidatos deduplicados y decide.
 *
 * Se deja registro de la decisión en `ctx.solomonDecision` para auditoría.
 * Ver ADR-003 para la motivación arquitectónica original; cierre en ADR-004.
 */
export class SolomonRole extends Role {
  /**
   * @param {{
   *   name: string,
   *   logger: Logger,
   *   strategy?: SolomonStrategy,
   *   sourceWeights?: Record<string, number>,
   *   arbiter?: SolomonArbiter,
   * }} opts
   */
  constructor(opts) {
    super({ name: opts.name, logger: opts.logger });
    this.strategy = opts.strategy ?? 'majority';
    this.sourceWeights = opts.sourceWeights ?? {};
    this.arbiter = opts.arbiter;

    if (this.strategy === 'llm-arbiter' && typeof this.arbiter !== 'function') {
      throw new Error('SolomonRole: strategy="llm-arbiter" requiere un arbiter callable.');
    }
  }

  /**
   * @param {SolomonInput} input
   * @param {ToolBox & { metadata?: Record<string, unknown>, logger?: Logger }} ctx
   * @returns {Promise<SolomonVerdict>}
   */
  async run(input, ctx) {
    if (!input || !Array.isArray(input.sourceResults)) {
      throw new Error('SolomonRole: input.sourceResults debe ser un array.');
    }
    const maxChunks = Math.max(1, input.maxChunks ?? 8);

    /** @type {SolomonVerdict} */
    let verdict;
    if (this.strategy === 'majority') {
      verdict = runMajority(input.sourceResults, maxChunks);
    } else if (this.strategy === 'weighted') {
      verdict = runWeighted(input.sourceResults, maxChunks, this.sourceWeights);
    } else {
      verdict = await runLlmArbiter(input, maxChunks, /** @type {SolomonArbiter} */ (this.arbiter));
    }

    // Registrar decisión para auditoría.
    /** @type {any} */
    const ctxAny = ctx;
    if (ctxAny && typeof ctxAny === 'object') {
      if (!ctxAny.metadata) ctxAny.metadata = {};
      ctxAny.metadata.solomonDecision = {
        strategy: verdict.strategy,
        rationale: verdict.rationale,
        sourceWeights: verdict.sourceWeights,
        sourcesCount: input.sourceResults.length,
        selectedIds: verdict.chunks.map((c) => c.id),
      };
    }

    return verdict;
  }
}

/**
 * Agrupa hits por id, acumulando score y rastreando en qué sources aparece cada uno.
 *
 * @param {SolomonSourceResult[]} sourceResults
 * @returns {Map<string, { hit: SearchHit, totalScore: number, sources: Set<string> }>}
 */
function groupById(sourceResults) {
  /** @type {Map<string, { hit: SearchHit, totalScore: number, sources: Set<string> }>} */
  const map = new Map();
  for (const sr of sourceResults) {
    for (const hit of sr.hits) {
      const entry = map.get(hit.id);
      if (entry) {
        entry.totalScore += hit.score;
        entry.sources.add(sr.source);
      } else {
        map.set(hit.id, {
          hit,
          totalScore: hit.score,
          sources: new Set([sr.source]),
        });
      }
    }
  }
  return map;
}

/**
 * Estrategia majority: chunks que aparecen en más sources suben en el ranking.
 * Score final = (suma scores) * (número de sources donde aparece).
 *
 * @param {SolomonSourceResult[]} sourceResults
 * @param {number} maxChunks
 * @returns {SolomonVerdict}
 */
function runMajority(sourceResults, maxChunks) {
  const grouped = groupById(sourceResults);
  const items = [...grouped.values()].map((e) => ({
    hit: { ...e.hit, score: e.totalScore * e.sources.size },
    occurrences: e.sources.size,
  }));
  items.sort((a, b) => b.hit.score - a.hit.score);

  const selected = items.slice(0, maxChunks).map((i) => i.hit);
  const maxOccurrences = items.reduce((m, i) => Math.max(m, i.occurrences), 0);
  const sourceWeights = Object.fromEntries(sourceResults.map((sr) => [sr.source, 1]));

  return {
    chunks: selected,
    rationale: `majority: ${sourceResults.length} sources, max co-ocurrencia=${maxOccurrences}`,
    sourceWeights,
    strategy: 'majority',
  };
}

/**
 * Estrategia weighted: aplica peso por source. Score final = suma(score * weight[source]).
 * Pesos no presentes en `sourceWeights` usan 1.0 por defecto.
 *
 * @param {SolomonSourceResult[]} sourceResults
 * @param {number} maxChunks
 * @param {Record<string, number>} sourceWeights
 * @returns {SolomonVerdict}
 */
function runWeighted(sourceResults, maxChunks, sourceWeights) {
  /** @type {Map<string, { hit: SearchHit, weighted: number }>} */
  const map = new Map();
  const effectiveWeights = {};
  for (const sr of sourceResults) {
    const w = sourceWeights[sr.source] ?? 1;
    effectiveWeights[sr.source] = w;
    for (const hit of sr.hits) {
      const entry = map.get(hit.id);
      const weighted = hit.score * w;
      if (entry) {
        entry.weighted += weighted;
      } else {
        map.set(hit.id, { hit, weighted });
      }
    }
  }

  const items = [...map.values()].map((e) => ({ ...e.hit, score: e.weighted }));
  items.sort((a, b) => b.score - a.score);

  return {
    chunks: items.slice(0, maxChunks),
    rationale: `weighted: pesos aplicados a ${sourceResults.length} sources`,
    sourceWeights: effectiveWeights,
    strategy: 'weighted',
  };
}

/**
 * Estrategia llm-arbiter: dedupe por id, pasa candidatos al arbiter externo,
 * normaliza el verdict.
 *
 * @param {SolomonInput} input
 * @param {number} maxChunks
 * @param {SolomonArbiter} arbiter
 * @returns {Promise<SolomonVerdict>}
 */
async function runLlmArbiter(input, maxChunks, arbiter) {
  const grouped = groupById(input.sourceResults);
  const candidates = [...grouped.values()].map((e) => ({
    ...e.hit,
    score: e.totalScore,
  }));
  const sources = input.sourceResults.map((sr) => sr.source);

  const decision = await arbiter({ query: input.query, candidates, sources });
  const chunks = Array.isArray(decision?.chunks) ? decision.chunks.slice(0, maxChunks) : [];
  const rationale = decision?.rationale ?? `llm-arbiter: ${chunks.length} chunks seleccionados`;

  const sourceWeights = Object.fromEntries(sources.map((s) => [s, 1]));

  return {
    chunks,
    rationale,
    sourceWeights,
    strategy: 'llm-arbiter',
  };
}
