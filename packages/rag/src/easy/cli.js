// @ts-check
/**
 * Capa Easy RAG — parsing y wiring del subcomando `index` (ADR-005 §1 y §4).
 *
 * Defaults deterministas: store `lancedb` (local, requiere el peer
 * @lancedb/lancedb — sin fallback silencioso) y embedder `hash`. Las
 * alternativas se activan por flag y fallan con mensaje accionable si
 * les falta configuración (peer no instalado, PG_URL ausente).
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHashEmbedder } from '../embedding/embedder.js';
import { createTransformersEmbedder } from '../embedding/transformers-embedder.js';
import { InMemoryVectorStore } from '../vector-store/in-memory-vector-store.js';
import { LanceDBStore } from '../vector-store/lancedb-store.js';
import { PgVectorStore } from '../vector-store/pgvector-store.js';
import { MANIFEST_DIR, loadManifest } from './manifest.js';
import { indexDirectory } from './indexer.js';
import { queryIndex } from './query.js';
import { GeneratorRole } from '../generation/generator-role.js';
import { createDefaultAdapterRegistry } from '../ai/adapter-registry.js';

const STORES = Object.freeze(['lancedb', 'pgvector', 'in-memory']);
const EMBEDDERS = Object.freeze(['hash', 'transformers']);

/** Dimensión por defecto de cada embedder cuando no se pasa --dimensions. */
const DEFAULT_DIMENSIONS = Object.freeze({ hash: 256, transformers: 384 });

/**
 * @typedef {object} IndexCliOptions
 * @property {string} rootDir
 * @property {'lancedb' | 'pgvector' | 'in-memory'} store
 * @property {'hash' | 'transformers'} embedder
 * @property {number} dimensions
 */

/**
 * Parsea los argumentos de `karajan-rag index <ruta> [--store] [--embedder] [--dimensions]`.
 *
 * @param {string[]} argv Argumentos tras el nombre del subcomando.
 * @returns {IndexCliOptions}
 */
export function parseIndexArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      store: { type: 'string', default: 'lancedb' },
      embedder: { type: 'string', default: 'hash' },
      dimensions: { type: 'string' },
    },
  });

  const rootDir = positionals[0];
  if (!rootDir) {
    throw new Error('index: falta la ruta del directorio a indexar.');
  }
  const store = /** @type {IndexCliOptions['store']} */ (values.store);
  if (!STORES.includes(store)) {
    throw new Error(`index: --store "${store}" no soportado (esperado: ${STORES.join(', ')}).`);
  }
  const embedder = /** @type {IndexCliOptions['embedder']} */ (values.embedder);
  if (!EMBEDDERS.includes(embedder)) {
    throw new Error(
      `index: --embedder "${embedder}" no soportado (esperado: ${EMBEDDERS.join(', ')}).`,
    );
  }
  const dimensions = values.dimensions
    ? Number.parseInt(values.dimensions, 10)
    : DEFAULT_DIMENSIONS[embedder];
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('index: --dimensions debe ser un entero positivo.');
  }
  return { rootDir: path.resolve(rootDir), store, embedder, dimensions };
}

/**
 * Construye embedder y store a partir de las opciones parseadas.
 *
 * @param {IndexCliOptions} options
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<{ embedder: import('./indexer.js').EasyEmbedder, store: import('./indexer.js').EasyVectorStore }>}
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
        'index: --store pgvector requiere la variable de entorno PG_URL (o DATABASE_URL).',
      );
    }
    return { embedder, store: new PgVectorStore({ connectionString, dimensions }) };
  }
  return { embedder, store: new InMemoryVectorStore({ dimensions }) };
}

/**
 * @typedef {object} QueryCliOptions
 * @property {string} question
 * @property {string} rootDir
 * @property {'lancedb' | 'pgvector'} store
 * @property {number} topK
 * @property {boolean} answer
 * @property {string} adapter
 */

const QUERY_STORES = Object.freeze(['lancedb', 'pgvector']);

/**
 * Parsea `karajan-rag query "<pregunta>" [ruta] [--store] [--top-k N] [--answer] [--adapter <cli>]`.
 *
 * @param {string[]} argv
 * @returns {QueryCliOptions}
 */
export function parseQueryArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      store: { type: 'string', default: 'lancedb' },
      'top-k': { type: 'string', default: '5' },
      answer: { type: 'boolean', default: false },
      adapter: { type: 'string', default: 'claude' },
    },
  });

  const question = positionals[0];
  if (!question || question.trim().length === 0) {
    throw new Error('query: falta la pregunta (karajan-rag query "<pregunta>" [ruta]).');
  }
  const store = /** @type {QueryCliOptions['store']} */ (values.store);
  if (!QUERY_STORES.includes(store)) {
    throw new Error(
      `query: --store "${store}" no soportado (esperado: ${QUERY_STORES.join(', ')} — ` +
        'in-memory no persiste índices, no es consultable).',
    );
  }
  const topK = Number.parseInt(String(values['top-k']), 10);
  if (!Number.isInteger(topK) || topK <= 0) {
    throw new Error('query: --top-k debe ser un entero positivo.');
  }
  return {
    question: question.trim(),
    rootDir: path.resolve(positionals[1] ?? '.'),
    store,
    topK,
    answer: values.answer === true,
    adapter: String(values.adapter),
  };
}

/**
 * Deriva embedder y dimensiones del fingerprint del manifest
 * (`nombre|dimensiones|hash`), evitando desajustes de espacio vectorial.
 *
 * @param {string} fingerprint
 * @returns {{ embedder: IndexCliOptions['embedder'], dimensions: number }}
 */
export function parseFingerprint(fingerprint) {
  const [name, rawDimensions] = String(fingerprint ?? '').split('|');
  const dimensions = Number.parseInt(rawDimensions, 10);
  if (!EMBEDDERS.includes(/** @type {never} */ (name)) || !Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(
      `query: fingerprint de índice no reconocido ("${fingerprint}"). Reindexa con karajan-rag index.`,
    );
  }
  return { embedder: /** @type {IndexCliOptions['embedder']} */ (name), dimensions };
}

/**
 * Ejecuta el subcomando `query` end-to-end.
 *
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, log?: (msg: string) => void, out?: (msg: string) => void }} [io]
 * @returns {Promise<import('./query.js').EasyQueryResult & { answer?: string }>}
 */
export async function runQueryCommand(argv, io = {}) {
  const log = io.log ?? ((msg) => console.error(`[query] ${msg}`));
  const out = io.out ?? ((msg) => console.log(msg));
  const options = parseQueryArgs(argv);

  const manifest = await loadManifest(options.rootDir);
  if (manifest === null) {
    throw new Error(
      `query: no hay índice en "${options.rootDir}". Créalo con: karajan-rag index ${options.rootDir}`,
    );
  }
  const { embedder: embedderName, dimensions } = parseFingerprint(manifest.fingerprint);
  const { embedder, store } = await createEasyDeps(
    { rootDir: options.rootDir, store: options.store, embedder: embedderName, dimensions },
    io.env ?? process.env,
  );

  const result = await queryIndex(options.question, {
    rootDir: options.rootDir,
    store: /** @type {never} */ (store),
    embedder,
    topK: options.topK,
  });

  if (result.hits.length === 0) {
    log('sin resultados.');
    return result;
  }
  for (const [i, hit] of result.hits.entries()) {
    const location = hit.line === null ? hit.source : `${hit.source}:${hit.line}`;
    out(`${i + 1}. ${location} (score ${hit.score.toFixed(3)})`);
    out(`   ${hit.content.replaceAll('\n', '\n   ')}`);
  }

  if (!options.answer) return result;

  const adapterRegistry = await createDefaultAdapterRegistry();
  const generator = new GeneratorRole({
    name: 'easy-query-generator',
    logger: { info: log, warn: log, error: log },
    adapterName: options.adapter,
  });
  const generated = await generator.run(
    {
      query: options.question,
      contextChunks: result.hits.map((h) => ({
        id: h.id,
        score: h.score,
        metadata: { content: h.content, source: h.source },
      })),
    },
    {
      get: (name) => adapterRegistry.get(name),
      has: (name) => adapterRegistry.has(name),
    },
  );
  out('');
  out(`--- respuesta (${options.adapter}) ---`);
  out(generated.answer);
  return { ...result, answer: generated.answer };
}

/**
 * Ejecuta el subcomando `index` end-to-end.
 *
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, log?: (msg: string) => void }} [io]
 * @returns {Promise<import('./indexer.js').IndexResult>}
 */
export async function runIndexCommand(argv, io = {}) {
  const log = io.log ?? ((msg) => console.error(`[index] ${msg}`));
  const options = parseIndexArgs(argv);
  const { embedder, store } = await createEasyDeps(options, io.env ?? process.env);

  if (options.store === 'in-memory') {
    log('aviso: --store in-memory es efímero — útil solo para pruebas.');
  }

  const result = await indexDirectory(options.rootDir, { store, embedder, onEvent: log });
  log(
    `hecho: ${result.indexedFiles} indexados, ${result.unchangedFiles} sin cambios, ` +
      `${result.removedFiles} invalidados, ${result.chunksUpserted} chunks` +
      (result.fullReindex ? ' (reindex completo por cambio de fingerprint)' : ''),
  );
  if (result.excluded.length > 0) {
    log(`excluidos: ${result.excluded.map((e) => `${e.path} (${e.reason})`).join(', ')}`);
  }
  return result;
}
