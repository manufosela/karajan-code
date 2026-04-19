// @ts-check

/**
 * @typedef {import('../vector-store/in-memory-vector-store.js').SearchHit} SearchHit
 */

/**
 * @typedef {Object} DedupeOptions
 * @property {number} [threshold] Umbral de Jaccard (0..1). Default 0.6 (>60%).
 * @property {(content: string) => Set<string>} [tokenizer] Customizable. Default: lowercase split alfanumérico.
 */

/**
 * @typedef {Object} DedupeReport
 * @property {SearchHit[]} kept
 * @property {Array<{ dropped: string, duplicateOf: string, similarity: number }>} dropped
 */

/**
 * Tokenizer default: lowercase + split alfanumérico + dedup a set.
 *
 * @param {string} content
 * @returns {Set<string>}
 */
function defaultTokenizer(content) {
  const words = String(content ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return new Set(words);
}

/**
 * Jaccard similarity entre dos sets: |A ∩ B| / |A ∪ B|.
 *
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deduplica hits que comparten un porcentaje de contenido por encima del
 * umbral. Conserva siempre el de mayor score; marca los descartados en el
 * report con el id del duplicate ganador y el valor de similitud.
 *
 * @param {SearchHit[]} hits
 * @param {DedupeOptions} [options]
 * @returns {DedupeReport}
 */
export function dedupeChunksByOverlap(hits, options = {}) {
  if (!Array.isArray(hits)) {
    throw new Error('dedupeChunksByOverlap: "hits" debe ser array.');
  }
  const threshold = options.threshold ?? 0.6;
  if (threshold < 0 || threshold > 1) {
    throw new Error('dedupeChunksByOverlap: "threshold" debe estar en [0, 1].');
  }
  const tokenize = options.tokenizer ?? defaultTokenizer;

  // Ordena por score descendente para que el primero sobreviva a los duplicados.
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  const tokens = sorted.map((h) => tokenize(String(h.metadata?.content ?? h.id)));

  /** @type {SearchHit[]} */
  const kept = [];
  /** @type {number[]} */
  const keptIndices = [];
  /** @type {Array<{ dropped: string, duplicateOf: string, similarity: number }>} */
  const dropped = [];

  for (let i = 0; i < sorted.length; i += 1) {
    let duplicateOf = null;
    let bestSim = 0;
    for (const kIdx of keptIndices) {
      const sim = jaccard(tokens[i], tokens[kIdx]);
      if (sim >= threshold && sim > bestSim) {
        duplicateOf = sorted[kIdx].id;
        bestSim = sim;
      }
    }
    if (duplicateOf) {
      dropped.push({ dropped: sorted[i].id, duplicateOf, similarity: bestSim });
    } else {
      kept.push(sorted[i]);
      keptIndices.push(i);
    }
  }

  return { kept, dropped };
}
