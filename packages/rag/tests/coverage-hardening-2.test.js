// @ts-check
/**
 * Segunda ronda de tests dirigidos a ramas (KJR-TSK-0128).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { buildPipelineFromConfig } from '../src/config/pipeline-builder.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { createCachedEmbedder } from '../src/embedding/embedding-cache.js';
import { createTransformersEmbedder } from '../src/embedding/transformers-embedder.js';
import { dedupeChunksByOverlap } from '../src/retrieval/chunk-dedupe.js';
import { migrateVectorStore } from '../src/vector-store/migrate.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { PgVectorStore } from '../src/vector-store/pgvector-store.js';
import { LanceDBStore } from '../src/vector-store/lancedb-store.js';
import { queryIndex } from '../src/easy/query.js';
import { startRagMcpServer, handleMcpMessage } from '../src/easy/mcp-server.js';
import { createRagService } from '../src/easy/rag-service.js';
import { createEmptyManifest } from '../src/easy/manifest.js';
import { runDoctorChecks } from '../src/easy/doctor.js';
import { runServeCommand } from '../src/easy/cli.js';

test('buildPipelineFromConfig: valida config y registry', () => {
  assert.throws(() => buildPipelineFromConfig(/** @type {never} */ (null), /** @type {never} */ ({})), /stages/);
  assert.throws(
    () => buildPipelineFromConfig(/** @type {never} */ ({ stages: [] }), /** @type {never} */ ({})),
    /RoleRegistry/,
  );
});

test('createCachedEmbedder: validación, stats externas y store sin size', async () => {
  assert.throws(() => createCachedEmbedder(/** @type {never} */ ({})), /baseEmbedder/);

  const base = createHashEmbedder({ dimensions: 8 });
  const storeWithoutSize = {
    _map: new Map(),
    async get(key) {
      return this._map.get(key);
    },
    async set(key, value) {
      this._map.set(key, value);
    },
  };
  const cached = createCachedEmbedder(base, {
    store: /** @type {never} */ (storeWithoutSize),
    stats: { hits: 5, misses: 2, evictions: 1 },
  });
  await cached.embed('x');
  assert.equal(cached.stats.size, undefined, 'store sin .size numérico → undefined');
  assert.ok(cached.stats.misses >= 3, 'arranca desde las stats externas');

  const batch = await cached.embedBatch(['x', 'y', 'x']);
  assert.equal(batch.length, 3);
  assert.deepEqual(batch[0], batch[2], 'los duplicados del batch comparten vector');
});

test('createTransformersEmbedder: validación de dimensiones y errores del loader', async () => {
  assert.throws(() => createTransformersEmbedder({ dimensions: -1 }), /dimensions/);

  const wrongDims = createTransformersEmbedder({
    dimensions: 4,
    loader: async () => async () => ({ data: [1, 2] }),
  });
  await assert.rejects(() => wrongDims.embed('x'), /dimensión devuelta 2/);

  const brokenLoader = createTransformersEmbedder({
    loader: async () => {
      throw new Error('fallo de red');
    },
  });
  await assert.rejects(() => brokenLoader.embed('x'), /fallo de red/);

  const arrayOut = createTransformersEmbedder({
    dimensions: 3,
    loader: async () => async () => [0.1, 0.2, 0.3],
  });
  const embedded = await arrayOut.embedBatch(['a']);
  assert.deepEqual(embedded[0], [0.1, 0.2, 0.3], 'acepta salida array directa');
});

test('dedupeChunksByOverlap: validación de hits y threshold', () => {
  assert.throws(() => dedupeChunksByOverlap(/** @type {never} */ (null)), /array/);
  assert.throws(() => dedupeChunksByOverlap([], { threshold: 2 }), /threshold/);
  const { kept } = dedupeChunksByOverlap([], { threshold: 0.5 });
  assert.deepEqual(kept, []);
});

test('migrateVectorStore: valida capacidades de origen y destino', async () => {
  const good = new InMemoryVectorStore({ dimensions: 2 });
  await assert.rejects(
    () => migrateVectorStore(/** @type {never} */ ({ dimensions: 2 }), good),
    /scan\(\)/,
  );
  await assert.rejects(
    () => migrateVectorStore(good, /** @type {never} */ ({ dimensions: 2 })),
    /upsert\(\)/,
  );
});

test('PgVectorStore: validaciones y search con filter sobre mock', async () => {
  const rows = [
    { id: 'a', embedding: '[1,0]', metadata: { tipo: 'x' }, score: 0.9 },
    { id: 'b', embedding: '[0,1]', metadata: { tipo: 'y' }, score: 0.8 },
  ];
  const client = { async query() { return { rows, rowCount: rows.length }; } };
  const store = new PgVectorStore({ dimensions: 2, client });

  await assert.rejects(() => store.upsertOne(/** @type {never} */ ({ id: '', vector: [1, 2] })), /record.id/);
  await assert.rejects(() => store.upsertOne({ id: 'a', vector: [1], metadata: {} }), /dimensión/);
  await assert.rejects(() => store.search([1], {}), /dimensión/);

  const all = await store.search([1, 0], {});
  assert.equal(all.length, 2);
  const filtered = await store.search([1, 0], { filter: (meta) => meta?.tipo === 'y' });
  assert.deepEqual(filtered.map((h) => h.id), ['b']);
});

test('LanceDBStore: scan sin table.query da error accionable; search valida y filtra', async () => {
  const fakeTableNoQuery = {
    async delete() {},
    async add() {},
    async countRows() {
      return 1;
    },
  };
  const rows = [
    { id: 'a', vector: [1, 0], metadata: '{"tipo":"x"}', _distance: 0.1 },
    { id: 'b', vector: [0, 1], metadata: '{"tipo":"y"}', _distance: 0.4 },
  ];
  const fakeTableFull = {
    ...fakeTableNoQuery,
    search() {
      return {
        limit() {
          return { async toArray() { return rows; } };
        },
      };
    },
  };
  const makeStore = (table) =>
    new LanceDBStore({
      dimensions: 2,
      lancedb: {
        async connect() {
          return {
            async tableNames() {
              return ['karajan_rag_chunks'];
            },
            async openTable() {
              return table;
            },
          };
        },
      },
    });

  const noQuery = makeStore(fakeTableNoQuery);
  const iterator = noQuery.scan();
  await assert.rejects(() => iterator.next(), /table.query/);

  const full = makeStore(fakeTableFull);
  await assert.rejects(() => full.search([1], {}), /dimensión/);
  const filtered = await full.search([1, 0], { filter: (meta) => meta?.tipo === 'y' });
  assert.deepEqual(filtered.map((h) => h.id), ['b']);
});

test('queryIndex: hits sin source/offset devuelven line null sin romper', async () => {
  const embedder = createHashEmbedder({ dimensions: 8 });
  const store = new InMemoryVectorStore({ dimensions: 8 });
  store.upsertOne({
    id: 'sin-meta#0',
    vector: await embedder.embed('contenido huérfano'),
    metadata: { content: 'contenido huérfano' }, // sin source ni offset
  });
  const { hits } = await queryIndex('contenido huérfano', { rootDir: '.', store: /** @type {never} */ (store), embedder, topK: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, null);
  assert.equal(hits[0].source, '');
});

test('MCP transport: líneas vacías se ignoran y question no-string produce isError', async () => {
  const embedder = createHashEmbedder({ dimensions: 8 });
  const store = new InMemoryVectorStore({ dimensions: 8 });
  const service = createRagService({
    rootDir: '.',
    manifest: createEmptyManifest('hash|8|x'),
    embedder,
    store,
  });

  const input = new PassThrough();
  const output = new PassThrough();
  const server = startRagMcpServer(service, { input, output });
  const lines = [];
  output.on('data', (chunk) => lines.push(...chunk.toString().split('\n').filter(Boolean)));
  input.write('\n\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.close();
  assert.equal(lines.length, 1, 'las líneas vacías no generan respuesta');

  const bad = /** @type {any} */ (
    await handleMcpMessage(service, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'rag_query', arguments: { question: 42 } },
    })
  );
  assert.equal(bad.result.isError, true, 'question no-string → error de tool, no crash');

  const unknownNotification = await handleMcpMessage(service, {
    jsonrpc: '2.0',
    method: 'metodo/desconocido',
  });
  assert.equal(unknownNotification, null, 'notificación desconocida se ignora');
});

test('doctor: manifest corrupto reporta índice en error con fix', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cov2-'));
  try {
    await mkdir(path.join(root, '.karajan'), { recursive: true });
    await writeFile(path.join(root, '.karajan', 'manifest.json'), '{rotisimo', 'utf8');
    const checks = await runDoctorChecks(root, {
      env: {},
      importModule: async () => ({}),
      whichBin: async () => false,
      nodeVersion: '22.0.0',
    });
    const index = checks.find((c) => c.name === 'índice');
    assert.equal(index?.level, 'error');
    assert.match(String(index?.fix), /reindexa/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runServeCommand: sin índice falla con instrucción de creación', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cov2-'));
  try {
    await assert.rejects(
      () => runServeCommand([root, '--store', 'pgvector'], { env: { PG_URL: 'postgres://x@y/z' }, log: () => {} }),
      /karajan-rag index/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
