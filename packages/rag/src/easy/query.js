// @ts-check
/**
 * Capa Easy RAG — consulta directa del índice (ADR-005 §1).
 *
 * Retrieval híbrido en dos etapas sin credenciales:
 *   1. Vector search en el store persistente (candidatos amplios).
 *   2. BM25 sobre los candidatos + merge de scores normalizados.
 * Después dedupe por overlap y resolución best-effort de fichero:línea
 * leyendo el offset del chunk contra el fichero fuente actual.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BM25Index } from '../retrieval/bm25.js';
import { dedupeChunksByOverlap } from '../retrieval/chunk-dedupe.js';

/**
 * @typedef {import('./indexer.js').EasyEmbedder} EasyEmbedder
 *
 * @typedef {object} EasyQueryHit
 * @property {string} id
 * @property {string} content
 * @property {string} source Ruta relativa del fichero origen.
 * @property {number | null} line Línea 1-based del inicio del chunk (null si no resoluble).
 * @property {number} score Score híbrido normalizado en [0, 1].
 * @property {{ vector: number, bm25: number }} scores Componentes normalizados.
 *
 * @typedef {object} EasyQueryResult
 * @property {EasyQueryHit[]} hits
 * @property {number} candidates Nº de candidatos considerados antes del merge.
 */

/** Peso del componente vectorial en el score híbrido. */
const VECTOR_WEIGHT = 0.5;

/**
 * Normaliza un mapa id→score al rango [0, 1] (máx = 1). Corpus vacío → mapa vacío.
 *
 * @param {Map<string, number>} scores
 * @returns {Map<string, number>}
 */
function normalize(scores) {
  let max = 0;
  for (const value of scores.values()) max = Math.max(max, value);
  if (max <= 0) return new Map();
  return new Map([...scores].map(([id, value]) => [id, value / max]));
}

/**
 * Línea 1-based donde empieza `offset` dentro del fichero, o null si el
 * fichero ya no existe o el offset quedó fuera (fichero cambiado tras indexar).
 *
 * @param {string} rootDir
 * @param {unknown} source
 * @param {unknown} offset
 * @returns {Promise<number | null>}
 */
async function resolveLine(rootDir, source, offset) {
  if (typeof source !== 'string' || typeof offset !== 'number' || offset < 0) return null;
  try {
    const content = await readFile(path.join(rootDir, source), 'utf8');
    if (offset > content.length) return null;
    let line = 1;
    for (let i = 0; i < offset; i += 1) if (content[i] === '\n') line += 1;
    return line;
  } catch {
    return null;
  }
}

/**
 * Consulta el índice con retrieval híbrido (vector + BM25) y dedupe.
 *
 * @param {string} question
 * @param {{
 *   rootDir: string,
 *   store: { search: (vector: number[], options?: { topK?: number }) => unknown },
 *   embedder: EasyEmbedder,
 *   topK?: number,
 *   candidates?: number,
 * }} options
 * @returns {Promise<EasyQueryResult>}
 */
export async function queryIndex(question, options) {
  const trimmed = String(question ?? '').trim();
  if (trimmed.length === 0) {
    throw new Error('queryIndex: la pregunta no puede estar vacía.');
  }
  const { rootDir, store, embedder } = options;
  const topK = options.topK ?? 5;
  const candidateCount = options.candidates ?? Math.max(topK * 8, 32);

  const [queryVector] = await embedder.embedBatch([trimmed]);
  const rawHits = /** @type {{ id: string, score: number, metadata?: Record<string, unknown> }[]} */ (
    await store.search(queryVector, { topK: candidateCount })
  );
  if (rawHits.length === 0) return { hits: [], candidates: 0 };

  const bm25 = new BM25Index();
  for (const hit of rawHits) {
    bm25.add({ id: hit.id, content: String(hit.metadata?.content ?? '') });
  }
  const vectorScores = normalize(new Map(rawHits.map((h) => [h.id, h.score])));
  const bm25Scores = normalize(new Map(bm25.score(trimmed).map((s) => [s.id, s.score])));

  const merged = rawHits.map((hit) => ({
    ...hit,
    score:
      VECTOR_WEIGHT * (vectorScores.get(hit.id) ?? 0) +
      (1 - VECTOR_WEIGHT) * (bm25Scores.get(hit.id) ?? 0),
  }));

  const { kept } = dedupeChunksByOverlap(merged);
  const top = kept.slice(0, topK);

  const hits = await Promise.all(
    top.map(async (hit) => ({
      id: hit.id,
      content: String(hit.metadata?.content ?? ''),
      source: String(hit.metadata?.source ?? ''),
      line: await resolveLine(rootDir, hit.metadata?.source, hit.metadata?.offset),
      score: hit.score,
      scores: {
        vector: vectorScores.get(hit.id) ?? 0,
        bm25: bm25Scores.get(hit.id) ?? 0,
      },
    })),
  );

  return { hits, candidates: rawHits.length };
}
