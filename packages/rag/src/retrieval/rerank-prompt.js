// @ts-check
/**
 * Prompt-template auditado del Reranker LLM (roadmap 0.4.0, KJR-TSK-0114).
 *
 * El prompt es un artefacto de primera clase: vive aquí versionado (no
 * inline en el rol) y está congelado por tests snapshot
 * (`tests/rerank-prompt.test.js`). Cualquier cambio de redacción rompe
 * el snapshot y debe actualizarse conscientemente en el mismo PR,
 * subiendo `RERANK_PROMPT_VERSION`.
 */

/** Versión del template — subir en cada cambio de redacción. */
export const RERANK_PROMPT_VERSION = 1;

/** Máximo de caracteres de contenido por fragmento incluido en el prompt. */
export const RERANK_SNIPPET_MAX_CHARS = 500;

/**
 * @typedef {object} RerankPromptHit
 * @property {string} id
 * @property {Record<string, unknown>} [metadata] Se usa metadata.content como snippet.
 */

/**
 * Construye el prompt del reranker para una query y sus hits.
 *
 * @param {string} query
 * @param {RerankPromptHit[]} hits
 * @returns {string}
 */
export function buildRerankPrompt(query, hits) {
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('buildRerankPrompt: "query" no puede estar vacía.');
  }
  if (!Array.isArray(hits) || hits.length === 0) {
    throw new Error('buildRerankPrompt: "hits" debe ser un array no vacío.');
  }
  const items = hits
    .map(
      (h, i) =>
        `${i + 1}. id=${h.id}\n${String(h.metadata?.content ?? '').slice(0, RERANK_SNIPPET_MAX_CHARS)}`,
    )
    .join('\n---\n');
  return [
    'Eres un reranker. Reordena los siguientes fragmentos por relevancia para la query.',
    `Query: ${query}`,
    '',
    'Fragmentos:',
    items,
    '',
    'Responde EXCLUSIVAMENTE con un JSON: { "ranking": ["id1","id2",...] }.',
  ].join('\n');
}
