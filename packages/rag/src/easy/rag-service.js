// @ts-check
/**
 * Capa Easy RAG — servicio compartido de consulta (ADR-005 §7).
 *
 * `RagService` es el contrato único que consumen el CLI (`query`), el
 * servidor HTTP y el servidor MCP: la API es la misma sirviendo un
 * índice local (LanceDB) o remoto (pgvector), que es exactamente lo que
 * empaquetan la imagen Docker y el módulo Terraform de GCP.
 */
import path from 'node:path';
import { createHashEmbedder } from '../embedding/embedder.js';
import { createTransformersEmbedder } from '../embedding/transformers-embedder.js';
import { InMemoryVectorStore } from '../vector-store/in-memory-vector-store.js';
import { LanceDBStore } from '../vector-store/lancedb-store.js';
import { PgVectorStore } from '../vector-store/pgvector-store.js';
import { MANIFEST_DIR, loadManifest } from './manifest.js';
import { queryIndex } from './query.js';

/**
 * @typedef {import('./indexer.js').EasyEmbedder} EasyEmbedder
 * @typedef {import('./manifest.js').IndexManifest} IndexManifest
 *
 * @typedef {object} RagService
 * @property {(question: string, topK?: number) => Promise<import('./query.js').EasyQueryResult>} query
 * @property {() => Promise<{ fingerprint: string, files: number, chunks: number, store: string }>} status
 */

export const STORES = Object.freeze(['lancedb', 'pgvector', 'in-memory']);
export const EMBEDDERS = Object.freeze(['hash', 'transformers']);

/**
 * Deriva embedder y dimensiones del fingerprint del manifest
 * (`nombre|dimensiones|hash`), evitando desajustes de espacio vectorial.
 *
 * @param {string} fingerprint
 * @returns {{ embedder: 'hash' | 'transformers', dimensions: number }}
 */
export function parseFingerprint(fingerprint) {
  const [name, rawDimensions] = String(fingerprint ?? '').split('|');
  const dimensions = Number.parseInt(rawDimensions, 10);
  if (!EMBEDDERS.includes(/** @type {never} */ (name)) || !Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(
      `fingerprint de índice no reconocido ("${fingerprint}"). Reindexa con karajan-rag index.`,
    );
  }
  return { embedder: /** @type {'hash' | 'transformers'} */ (name), dimensions };
}

/**
 * Construye embedder y store a partir de opciones explícitas.
 *
 * @param {{ rootDir: string, store: 'lancedb' | 'pgvector' | 'in-memory', embedder: 'hash' | 'transformers', dimensions: number }} options
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<{ embedder: EasyEmbedder, store: import('./indexer.js').EasyVectorStore & { search: Function } }>}
 */
export async function createEasyDeps(options, env) {
  const { embedder: embedderName, store: storeName, dimensions, rootDir } = options;

  const embedder =
    embedderName === 'hash'
      ? { name: 'hash', ...createHashEmbedder({ dimensions }) }
      : { name: 'transformers', ...createTransformersEmbedder({ dimensions }) };

  if (storeName === 'lancedb') {
    const store = await LanceDBStore.open({
      path: path.join(rootDir, MANIFEST_DIR, 'index'),
      dimensions,
    });
    return { embedder, store };
  }
  if (storeName === 'pgvector') {
    const connectionString = env.PG_URL ?? env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        '--store pgvector requiere la variable de entorno PG_URL (o DATABASE_URL).',
      );
    }
    return { embedder, store: new PgVectorStore({ connectionString, dimensions }) };
  }
  return { embedder, store: new InMemoryVectorStore({ dimensions }) };
}

/**
 * Abre un índice existente: el manifest manda (embedder y dimensiones se
 * derivan de su fingerprint). Índice inexistente → error accionable.
 *
 * @param {string} rootDir
 * @param {{ store?: 'lancedb' | 'pgvector', env?: Record<string, string | undefined> }} [options]
 * @returns {Promise<{ manifest: IndexManifest, embedder: EasyEmbedder, store: never, storeName: string }>}
 */
export async function openEasyIndex(rootDir, options = {}) {
  const storeName = options.store ?? 'lancedb';
  const manifest = await loadManifest(rootDir);
  if (manifest === null) {
    throw new Error(
      `no hay índice en "${rootDir}". Créalo con: karajan-rag index ${rootDir}`,
    );
  }
  const { embedder: embedderName, dimensions } = parseFingerprint(manifest.fingerprint);
  const { embedder, store } = await createEasyDeps(
    { rootDir, store: storeName, embedder: embedderName, dimensions },
    options.env ?? process.env,
  );
  return { manifest, embedder, store: /** @type {never} */ (store), storeName };
}

/**
 * Servicio de consulta sobre deps ya construidas (inyectables en tests).
 *
 * @param {{ rootDir: string, manifest: IndexManifest, embedder: EasyEmbedder, store: { search: Function }, storeName?: string }} deps
 * @returns {RagService}
 */
export function createRagService(deps) {
  const { rootDir, manifest, embedder, store } = deps;
  const storeName = deps.storeName ?? 'custom';
  return {
    async query(question, topK = 5) {
      return queryIndex(question, {
        rootDir,
        store: /** @type {never} */ (store),
        embedder,
        topK,
      });
    },
    async status() {
      const files = Object.keys(manifest.files).length;
      const chunks = Object.values(manifest.files).reduce(
        (sum, entry) => sum + entry.chunkIds.length,
        0,
      );
      return { fingerprint: manifest.fingerprint, files, chunks, store: storeName };
    },
  };
}

/**
 * Conveniencia: abre el índice y devuelve el servicio listo.
 *
 * @param {string} rootDir
 * @param {{ store?: 'lancedb' | 'pgvector', env?: Record<string, string | undefined> }} [options]
 * @returns {Promise<RagService>}
 */
export async function openRagService(rootDir, options = {}) {
  const { manifest, embedder, store, storeName } = await openEasyIndex(rootDir, options);
  return createRagService({ rootDir, manifest, embedder, store, storeName });
}
