// @ts-check
/**
 * SDK embebible de karajan-rag (roadmap 0.6.0, KJR-TSK-0125).
 *
 * `createRag()` es la fachada programática para frameworks (Astro, Next,
 * Fastify, workers): sin CLI, misma maquinaria y mismos defaults ADR-005
 * que los subcomandos easy. No añade lógica nueva — compone las piezas
 * públicas existentes en una API mínima y estable:
 *
 *   const rag = await createRag({ rootDir: './docs' });
 *   await rag.index();
 *   const { hits } = await rag.query('¿cómo se factura?');
 *   await rag.close();
 *
 * Ejemplos por framework en docs/easy-rag.md → sección SDK.
 */
import path from 'node:path';
import { createEasyDeps } from './rag-service.js';
import { indexDirectory, DEFAULT_INGEST_BATCH_SIZE } from './indexer.js';
import { queryIndex } from './query.js';
import { loadManifest } from './manifest.js';
import { createRagService } from './rag-service.js';
import { buildCagContext, buildHybridContext } from './cag.js';
import { generateAnswerForHits } from './cli.js';

/**
 * @typedef {import('./indexer.js').EasyEmbedder} EasyEmbedder
 * @typedef {import('./indexer.js').EasyVectorStore} EasyVectorStore
 *
 * @typedef {object} CreateRagOptions
 * @property {string} [rootDir] Directorio del corpus/índice. Default '.'.
 * @property {'lancedb' | 'pgvector' | 'in-memory' | (EasyVectorStore & { search: Function })} [store]
 *   Nombre de backend (defaults ADR-005) o instancia inyectada. Default 'lancedb'.
 * @property {'hash' | 'transformers' | EasyEmbedder} [embedder]
 *   Nombre de embedder o instancia inyectada. Default 'hash'.
 * @property {number} [dimensions] Solo con embedder por nombre. Default 256 (hash) / 384 (transformers).
 * @property {number} [topK] Default de query. Default 5.
 * @property {number} [batchSize] Default de index. Default DEFAULT_INGEST_BATCH_SIZE.
 * @property {Record<string, string | undefined>} [env] Entorno para credenciales (PG_URL...). Default process.env.
 *
 * @typedef {object} RagAnswerOptions
 * @property {'rag' | 'cag' | 'hybrid'} [mode] Estrategia de contexto. Default 'rag'.
 * @property {string} [adapter] Adapter preferido. Default 'claude' (la policy decide).
 * @property {boolean} [adapterExplicit] true = elección explícita: no permitido → error, nunca degradación.
 * @property {{ get: (name: string) => unknown, has: (name: string) => boolean }} [registry] Registry de adapters inyectado.
 * @property {number} [topK] Solo rag/hybrid.
 * @property {number} [maxContextChars] Solo cag/hybrid.
 * @property {(msg: string) => void} [log]
 *
 * @typedef {object} RagAnswerResult
 * @property {string} answer
 * @property {string} adapter Adapter realmente usado tras la policy.
 * @property {import('../domain/document.js').Sensitivity} sensitivity Nivel efectivo del contexto.
 * @property {'rag' | 'cag' | 'hybrid'} mode
 * @property {string[]} [files] Ficheros del contexto (cag/hybrid).
 * @property {{ source: string, chars: number }[]} [excluded] Excluidos por presupuesto (hybrid).
 *
 * @typedef {object} Rag
 * @property {string} rootDir
 * @property {(options?: { batchSize?: number, onEvent?: (msg: string) => void }) => Promise<import('./indexer.js').IndexResult>} index
 *   Indexa (o reindexa incrementalmente) el rootDir.
 * @property {(question: string, options?: { topK?: number }) => Promise<import('./query.js').EasyQueryResult>} query
 *   Consulta híbrida (vector + BM25) contra el índice.
 * @property {(question: string, options?: RagAnswerOptions) => Promise<RagAnswerResult>} answer
 *   Respuesta LLM con el modo elegido — siempre por el camino guardado (policy + redactPII).
 * @property {() => Promise<{ fingerprint: string, files: number, chunks: number, store: string }>} status
 *   Estado del índice desde el manifest. Falla explícitamente si aún no hay índice.
 * @property {() => Promise<void>} close Cierra la conexión del store si éste lo soporta.
 */

/**
 * Crea una instancia RAG embebible.
 *
 * @param {CreateRagOptions} [options]
 * @returns {Promise<Rag>}
 */
export async function createRag(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? '.');

  /** @type {EasyVectorStore & { search: Function, close?: () => Promise<void> }} */
  let store;
  /** @type {EasyEmbedder} */
  let embedder;

  const storeIsInstance = typeof options.store === 'object' && options.store !== null;
  const embedderIsInstance = typeof options.embedder === 'object' && options.embedder !== null;

  if (storeIsInstance) store = /** @type {never} */ (options.store);
  if (embedderIsInstance) embedder = /** @type {EasyEmbedder} */ (options.embedder);

  if (!storeIsInstance || !embedderIsInstance) {
    const embedderName = embedderIsInstance
      ? 'hash' // irrelevante: solo se usa la parte que falte
      : /** @type {'hash' | 'transformers'} */ (options.embedder ?? 'hash');
    const dimensions =
      options.dimensions ??
      (embedderIsInstance ? embedder.dimensions : embedderName === 'transformers' ? 384 : 256);
    const deps = await createEasyDeps(
      {
        rootDir,
        store: storeIsInstance
          ? 'in-memory' // irrelevante: se descarta, solo se usa la parte que falte
          : /** @type {'lancedb' | 'pgvector' | 'in-memory'} */ (options.store ?? 'lancedb'),
        embedder: embedderName,
        dimensions,
      },
      options.env ?? process.env,
    );
    if (!storeIsInstance) store = /** @type {never} */ (deps.store);
    if (!embedderIsInstance) embedder = deps.embedder;
  }

  const storeName = storeIsInstance
    ? 'custom'
    : /** @type {string} */ (options.store ?? 'lancedb');

  return {
    rootDir,

    async index(indexOptions = {}) {
      return indexDirectory(rootDir, {
        store,
        embedder,
        batchSize: indexOptions.batchSize ?? options.batchSize ?? DEFAULT_INGEST_BATCH_SIZE,
        onEvent: indexOptions.onEvent,
      });
    },

    async query(question, queryOptions = {}) {
      return queryIndex(question, {
        rootDir,
        store: /** @type {never} */ (store),
        embedder,
        topK: queryOptions.topK ?? options.topK ?? 5,
      });
    },

    async answer(question, answerOptions = {}) {
      const mode = answerOptions.mode ?? 'rag';
      if (!['rag', 'cag', 'hybrid'].includes(mode)) {
        throw new Error(`createRag.answer: "mode" debe ser rag, cag o hybrid (recibido: "${mode}").`);
      }
      const log = answerOptions.log ?? (() => {});

      /** @type {import('./query.js').EasyQueryHit[]} */
      let hits;
      /** @type {string[] | undefined} */
      let files;
      /** @type {{ source: string, chars: number }[] | undefined} */
      let excluded;

      if (mode === 'cag') {
        const ctx = await buildCagContext(rootDir, { maxChars: answerOptions.maxContextChars });
        hits = ctx.hits;
        files = ctx.files;
      } else {
        const retrieved = await queryIndex(question, {
          rootDir,
          store: /** @type {never} */ (store),
          embedder,
          topK: answerOptions.topK ?? options.topK ?? 5,
        });
        if (retrieved.hits.length === 0) {
          throw new Error('createRag.answer: la consulta no recuperó nada del índice.');
        }
        if (mode === 'hybrid') {
          const ctx = await buildHybridContext(rootDir, {
            hits: retrieved.hits,
            maxChars: answerOptions.maxContextChars,
          });
          hits = ctx.hits;
          files = ctx.files;
          excluded = ctx.excluded;
        } else {
          hits = retrieved.hits;
        }
      }

      const generated = await generateAnswerForHits({
        question,
        hits,
        adapter: answerOptions.adapter ?? 'claude',
        adapterExplicit: answerOptions.adapterExplicit ?? false,
        registry: answerOptions.registry,
        log,
      });
      return {
        answer: generated.answer,
        adapter: generated.adapter,
        sensitivity: generated.sensitivity,
        mode,
        ...(files ? { files } : {}),
        ...(excluded ? { excluded } : {}),
      };
    },

    async status() {
      const manifest = await loadManifest(rootDir);
      if (manifest === null) {
        throw new Error(
          `createRag.status: no hay índice en "${rootDir}". Créalo con rag.index().`,
        );
      }
      return createRagService({ rootDir, manifest, embedder, store, storeName }).status();
    },

    async close() {
      if (typeof store.close === 'function') await store.close();
    },
  };
}
