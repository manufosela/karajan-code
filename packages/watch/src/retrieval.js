// @ts-check
/**
 * F2 — retrieval de candidatos de impacto cross-repo.
 *
 * Cada chunk del diff mergeado (KJW-TSK-0004) se consulta contra el
 * corpus `code` multi-repo y se conservan los hits de OTROS repos como
 * candidatos de daño colateral, deduplicados por fichero destino y con
 * su evidencia. Honestidad primero: esto es similitud semántica + BM25,
 * nunca análisis causal — la salida alimenta el ranking con evidencia.
 *
 * Workaround de KJR-PRP-0002 (queryIndex no filtra por origen): se
 * sobre-pide topK*OVERFETCH_FACTOR y se filtra post-hoc por `hit.source`
 * con frontera de segmento (`repo/` nunca matchea `repo-extra/`).
 */

/** Error de retrieval: el pipeline debe fallar ruidosamente, nunca a medias. */
export class RetrievalError extends Error {
  /**
   * @param {string} message
   * @param {{cause?: unknown}} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'RetrievalError';
  }
}

/** Sobre-pedido por query: el filtrado del repo origen es post-hoc y muerde el top-k. */
const OVERFETCH_FACTOR = 3;

/**
 * @typedef {import('./diff.js').DiffChunk} DiffChunk
 *
 * @typedef {Object} QueryHit
 * @property {string} source Path namespaceado `repo/…` del fichero que originó el hit.
 * @property {number | null} line Línea aproximada del hit en su fichero.
 * @property {number} score Score híbrido (vector + BM25) normalizado.
 *
 * @typedef {(question: string, options: {topK: number}) => Promise<{hits: QueryHit[], candidates: number}>} QueryFn
 *
 * @typedef {Object} CandidateEvidence
 * @property {{path: string, newStart: number}} fromChunk Chunk del diff que trajo el hit.
 * @property {number | null} line Línea del hit en el fichero candidato.
 * @property {number} score Score de ese hit concreto.
 *
 * @typedef {Object} ImpactCandidate
 * @property {string} source Fichero candidato (`repo/path`).
 * @property {string} repo Repo destino (primer segmento del source).
 * @property {number} score Máximo score entre las evidencias.
 * @property {CandidateEvidence[]} evidence
 *
 * @typedef {Object} RetrievalResult
 * @property {ImpactCandidate[]} candidates Ordenados por score descendente.
 * @property {number} rawCandidates Total de candidatos crudos vistos por las queries.
 */

/**
 * Busca candidatos de impacto consultando el corpus con cada chunk del diff.
 *
 * @param {Object} params
 * @param {DiffChunk[]} params.chunks Chunks del diff (parseUnifiedDiff).
 * @param {QueryFn} params.query Función de consulta (wrapper de queryIndex de karajan-rag).
 * @param {number} [params.topK] Máximo de candidatos finales (default 10).
 * @param {string} [params.excludeRepo] Repo origen a excluir (default: el repo de los chunks).
 * @returns {Promise<RetrievalResult>}
 */
export const findImpactCandidates = async ({ chunks, query, topK = 10, excludeRepo }) => {
  const queryable = chunks.filter((c) => c.text.length > 0);
  if (queryable.length === 0) {
    throw new RetrievalError(
      'ningún chunk consultable en el diff (¿solo binarios o renames puros?).',
    );
  }
  const originRepo = excludeRepo ?? queryable[0].repo;
  const originPrefix = `${originRepo}/`;

  /** @type {Map<string, ImpactCandidate>} */
  const bySource = new Map();
  let rawCandidates = 0;

  for (const diffChunk of queryable) {
    let response;
    try {
      response = await query(diffChunk.text, { topK: topK * OVERFETCH_FACTOR });
    } catch (err) {
      throw new RetrievalError(
        `query fallida para el chunk ${diffChunk.path}@${diffChunk.newStart}.`,
        { cause: err },
      );
    }
    rawCandidates += response.candidates;

    for (const responseHit of response.hits) {
      if (responseHit.source.startsWith(originPrefix)) continue;
      const existing = bySource.get(responseHit.source);
      const evidence = {
        fromChunk: { path: diffChunk.path, newStart: diffChunk.newStart },
        line: responseHit.line,
        score: responseHit.score,
      };
      if (existing) {
        existing.evidence.push(evidence);
        existing.score = Math.max(existing.score, responseHit.score);
      } else {
        bySource.set(responseHit.source, {
          source: responseHit.source,
          repo: responseHit.source.split('/')[0],
          score: responseHit.score,
          evidence: [evidence],
        });
      }
    }
  }

  if (rawCandidates === 0) {
    throw new RetrievalError(
      'corpus sin candidatos para ninguna query: índice vacío o corpus equivocado.',
    );
  }

  const candidates = [...bySource.values()]
    .toSorted((a, b) => b.score - a.score)
    .slice(0, topK);

  return { candidates, rawCandidates };
};
