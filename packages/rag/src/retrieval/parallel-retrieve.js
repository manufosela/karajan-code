// @ts-check

/**
 * @typedef {import('../vector-store/in-memory-vector-store.js').SearchHit} SearchHit
 * @typedef {import('./solomon-role.js').SolomonSourceResult} SolomonSourceResult
 */

/**
 * Fuente nombrada que produce hits para una query. El `retrieve` puede ser
 * un closure sobre un retriever concreto (RetrieverRole, BM25, HTTP, etc.).
 * Solomon solo necesita `{source, hits}`, no sabe nada del stack interno.
 *
 * @typedef {Object} RetrievalSource
 * @property {string} source Nombre del corpus o fuente.
 * @property {(query: string) => Promise<SearchHit[]>} retrieve
 */

/**
 * @typedef {Object} ParallelRetrieveOptions
 * @property {number} [timeoutMs] Si se pasa, cada source tiene ese tiempo
 *   como máximo antes de considerarse caída (no aborta al resto).
 * @property {import('../pipeline/types.js').Logger} [logger]
 */

/**
 * Helper que paraleliza los retrievers por source con `Promise.allSettled`,
 * tolera fallos individuales y devuelve un array con el formato que espera
 * `SolomonRole.run(input)`.
 *
 * Política:
 *   - Una source que rechace o que se pase del `timeoutMs` aporta `hits: []`
 *     y se logea un `warn` si hay `logger`. No aborta al resto.
 *   - El orden del resultado preserva el orden de entrada para que decisiones
 *     tipo "weighted" sean deterministas.
 *
 * @param {RetrievalSource[]} sources
 * @param {string} query
 * @param {ParallelRetrieveOptions} [options]
 * @returns {Promise<SolomonSourceResult[]>}
 */
export async function parallelRetrieve(sources, query, options = {}) {
  if (!Array.isArray(sources)) {
    throw new Error('parallelRetrieve: "sources" debe ser un array.');
  }
  if (typeof query !== 'string') {
    throw new Error('parallelRetrieve: "query" debe ser string.');
  }
  const { timeoutMs, logger } = options;

  const runs = sources.map((s) => wrapWithTimeout(s, query, timeoutMs));
  const settled = await Promise.allSettled(runs);

  /** @type {SolomonSourceResult[]} */
  const out = new Array(sources.length);
  for (let i = 0; i < sources.length; i += 1) {
    const result = settled[i];
    const name = sources[i].source;
    if (result.status === 'fulfilled') {
      out[i] = { source: name, hits: result.value ?? [] };
    } else {
      logger?.warn?.(`parallelRetrieve: source "${name}" falló — ${messageOf(result.reason)}`);
      out[i] = { source: name, hits: [] };
    }
  }
  return out;
}

/**
 * @param {RetrievalSource} source
 * @param {string} query
 * @param {number|undefined} timeoutMs
 * @returns {Promise<SearchHit[]>}
 */
async function wrapWithTimeout(source, query, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) {
    return source.retrieve(query);
  }
  return Promise.race([
    source.retrieve(query),
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function messageOf(err) {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}
