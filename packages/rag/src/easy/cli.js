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
import { appendFile, readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { MANIFEST_DIR } from './manifest.js';
import {
  STORES,
  EMBEDDERS,
  createEasyDeps,
  parseFingerprint,
  openEasyIndex,
  openRagService,
} from './rag-service.js';
import { startRagHttpServer } from './http-server.js';
import { startRagMcpServer } from './mcp-server.js';
import { indexDirectory } from './indexer.js';
import { queryIndex } from './query.js';
import {
  CONFIG_FILE,
  DEFAULT_EASY_CONFIG,
  loadEasyConfig,
  saveEasyConfig,
} from './config.js';
import { GeneratorRole } from '../generation/generator-role.js';
import { createDefaultAdapterRegistry } from '../ai/adapter-registry.js';

export { createEasyDeps, parseFingerprint };

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
 * Prioridad: flag explícito > `defaults` (config del proyecto) > default ADR-005.
 *
 * @param {string[]} argv Argumentos tras el nombre del subcomando.
 * @param {import('./config.js').EasyConfig} [defaults]
 * @returns {IndexCliOptions}
 */
export function parseIndexArgs(argv, defaults = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      store: { type: 'string' },
      embedder: { type: 'string' },
      dimensions: { type: 'string' },
    },
  });

  const rootDir = positionals[0];
  if (!rootDir) {
    throw new Error('index: falta la ruta del directorio a indexar.');
  }
  const store = /** @type {IndexCliOptions['store']} */ (values.store ?? defaults.store ?? 'lancedb');
  if (!STORES.includes(store)) {
    throw new Error(`index: --store "${store}" no soportado (esperado: ${STORES.join(', ')}).`);
  }
  const embedder = /** @type {IndexCliOptions['embedder']} */ (
    values.embedder ?? defaults.embedder ?? 'hash'
  );
  if (!EMBEDDERS.includes(embedder)) {
    throw new Error(
      `index: --embedder "${embedder}" no soportado (esperado: ${EMBEDDERS.join(', ')}).`,
    );
  }
  const dimensions = values.dimensions
    ? Number.parseInt(values.dimensions, 10)
    : (defaults.dimensions ?? DEFAULT_DIMENSIONS[embedder]);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('index: --dimensions debe ser un entero positivo.');
  }
  return { rootDir: path.resolve(rootDir), store, embedder, dimensions };
}

/**
 * Parsea `karajan-rag init [ruta] [--yes] [--force]`.
 *
 * @param {string[]} argv
 * @returns {{ rootDir: string, yes: boolean, force: boolean }}
 */
export function parseInitArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      yes: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  });
  return {
    rootDir: path.resolve(positionals[0] ?? '.'),
    yes: values.yes === true,
    force: values.force === true,
  };
}

/**
 * Pregunta interactiva con default; en modo --yes no se llama nunca.
 *
 * @param {string} question
 * @param {string} defaultValue
 * @returns {Promise<string>}
 */
async function askInTerminal(question, defaultValue) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const reply = await rl.question(`${question} [${defaultValue}]: `);
    return reply.trim() === '' ? defaultValue : reply.trim();
  } finally {
    rl.close();
  }
}

/**
 * Añade `.karajan/` al .gitignore del proyecto (creándolo si no existe),
 * salvo que ya esté presente.
 *
 * @param {string} rootDir
 * @returns {Promise<boolean>} true si se modificó el .gitignore.
 */
async function ensureKarajanGitignored(rootDir) {
  const gitignorePath = path.join(rootDir, '.gitignore');
  let current = '';
  try {
    current = await readFile(gitignorePath, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
  }
  const hasEntry = current
    .split('\n')
    .some((line) => line.trim() === `${MANIFEST_DIR}/` || line.trim() === MANIFEST_DIR);
  if (hasEntry) return false;
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
  await appendFile(gitignorePath, `${prefix}${MANIFEST_DIR}/\n`, 'utf8');
  return true;
}

/**
 * Ejecuta el subcomando `init`: genera karajan.config.json con defaults
 * ADR-005 (wizard interactivo salvo --yes) y gitignora `.karajan/`.
 *
 * @param {string[]} argv
 * @param {{ log?: (msg: string) => void, ask?: (question: string, defaultValue: string) => Promise<string> }} [io]
 * @returns {Promise<import('./config.js').EasyConfig>}
 */
export async function runInitCommand(argv, io = {}) {
  const log = io.log ?? ((msg) => console.error(`[init] ${msg}`));
  const ask = io.ask ?? askInTerminal;
  const { rootDir, yes, force } = parseInitArgs(argv);

  const configPath = path.join(rootDir, CONFIG_FILE);
  const exists = await stat(configPath).then(
    () => true,
    () => false,
  );
  if (exists && !force) {
    throw new Error(`init: ${CONFIG_FILE} ya existe en "${rootDir}". Usa --force para regenerarlo.`);
  }

  /** @type {import('./config.js').EasyConfig} */
  let easy = { ...DEFAULT_EASY_CONFIG };
  if (!yes) {
    const store = await ask(`vector store (${STORES.join('/')})`, String(DEFAULT_EASY_CONFIG.store));
    const embedder = await ask(
      `embedder (${EMBEDDERS.join('/')})`,
      String(DEFAULT_EASY_CONFIG.embedder),
    );
    const dimensions = await ask(
      'dimensiones del embedding',
      String(DEFAULT_DIMENSIONS[/** @type {never} */ (embedder)] ?? DEFAULT_EASY_CONFIG.dimensions),
    );
    easy = {
      ...easy,
      store: /** @type {never} */ (store),
      embedder: /** @type {never} */ (embedder),
      dimensions: Number.parseInt(dimensions, 10),
    };
  }

  await saveEasyConfig(rootDir, easy);
  log(`generado ${CONFIG_FILE} (store=${easy.store}, embedder=${easy.embedder}, dims=${easy.dimensions})`);
  if (await ensureKarajanGitignored(rootDir)) {
    log(`añadido ${MANIFEST_DIR}/ a .gitignore`);
  }
  log(`siguiente paso: karajan-rag index ${rootDir}`);
  return easy;
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
export function parseQueryArgs(argv, defaults = /** @type {import('./config.js').EasyConfig} */ ({})) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      store: { type: 'string' },
      'top-k': { type: 'string' },
      answer: { type: 'boolean', default: false },
      adapter: { type: 'string' },
    },
  });

  const question = positionals[0];
  if (!question || question.trim().length === 0) {
    throw new Error('query: falta la pregunta (karajan-rag query "<pregunta>" [ruta]).');
  }
  const store = /** @type {QueryCliOptions['store']} */ (values.store ?? defaults.store ?? 'lancedb');
  if (!QUERY_STORES.includes(store)) {
    throw new Error(
      `query: --store "${store}" no soportado (esperado: ${QUERY_STORES.join(', ')} — ` +
        'in-memory no persiste índices, no es consultable).',
    );
  }
  const topK = values['top-k']
    ? Number.parseInt(String(values['top-k']), 10)
    : (defaults.topK ?? 5);
  if (!Number.isInteger(topK) || topK <= 0) {
    throw new Error('query: --top-k debe ser un entero positivo.');
  }
  return {
    question: question.trim(),
    rootDir: path.resolve(positionals[1] ?? '.'),
    store,
    topK,
    answer: values.answer === true,
    adapter: String(values.adapter ?? defaults.adapter ?? 'claude'),
  };
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
  const pre = parseQueryArgs(argv);
  const config = await loadEasyConfig(pre.rootDir);
  const options = config ? parseQueryArgs(argv, config) : pre;

  const { embedder, store } = await openEasyIndex(options.rootDir, {
    store: options.store,
    env: io.env ?? process.env,
  });

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
 * Parsea `karajan-rag serve [ruta] [--http] [--mcp] [--port N] [--store lancedb|pgvector]`.
 *
 * Modo por defecto: MCP stdio. `--http` y `--mcp` son excluyentes (MCP
 * usa stdout para el protocolo; mezclar ambos en un proceso lo rompería).
 *
 * @param {string[]} argv
 * @returns {{ rootDir: string, mode: 'mcp' | 'http', port: number, store: 'lancedb' | 'pgvector' }}
 */
export function parseServeArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      http: { type: 'boolean', default: false },
      mcp: { type: 'boolean', default: false },
      port: { type: 'string' },
      store: { type: 'string', default: 'lancedb' },
    },
  });
  if (values.http && values.mcp) {
    throw new Error('serve: --http y --mcp son excluyentes (usa dos procesos si necesitas ambos).');
  }
  const store = /** @type {'lancedb' | 'pgvector'} */ (values.store);
  if (!QUERY_STORES.includes(store)) {
    throw new Error(`serve: --store "${store}" no soportado (esperado: ${QUERY_STORES.join(', ')}).`);
  }
  const port = values.port ? Number.parseInt(values.port, 10) : 8080;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('serve: --port debe ser un entero en [0, 65535].');
  }
  return {
    rootDir: path.resolve(positionals[0] ?? '.'),
    mode: values.http ? 'http' : 'mcp',
    port,
    store,
  };
}

/**
 * Ejecuta el subcomando `serve`: expone el índice como servidor MCP
 * (stdio, default) o HTTP. Devuelve los handles sin bloquear — el
 * proceso queda vivo mientras el servidor/stdin sigan abiertos.
 *
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, log?: (msg: string) => void, input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} [io]
 * @returns {Promise<{ mode: 'mcp' | 'http', url?: string, close: () => Promise<void> | void }>}
 */
export async function runServeCommand(argv, io = {}) {
  const log = io.log ?? ((msg) => console.error(`[serve] ${msg}`));
  const options = parseServeArgs(argv);
  const service = await openRagService(options.rootDir, {
    store: options.store,
    env: io.env ?? process.env,
  });

  if (options.mode === 'http') {
    const { server, url } = await startRagHttpServer(service, { port: options.port });
    log(`HTTP escuchando en ${url} (POST /query, GET /health)`);
    return {
      mode: 'http',
      url,
      close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
    };
  }

  const mcp = startRagMcpServer(service, { input: io.input, output: io.output });
  log(`MCP stdio listo (tools: rag_query, rag_status) sobre ${options.rootDir}`);
  return { mode: 'mcp', close: mcp.close };
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
  const pre = parseIndexArgs(argv);
  const config = await loadEasyConfig(pre.rootDir);
  const options = config ? parseIndexArgs(argv, config) : pre;
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
