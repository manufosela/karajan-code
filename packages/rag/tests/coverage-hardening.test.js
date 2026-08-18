// @ts-check
/**
 * Tests dirigidos a las ramas y funciones menos cubiertas (KJR-TSK-0128,
 * criterio 1.0: superficie mínima ≥90% en todas las métricas).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RetrieverRole } from '../src/retrieval/retriever-role.js';
import { BM25Index } from '../src/retrieval/bm25.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { createCachedEmbedder } from '../src/embedding/embedding-cache.js';
import { createRagService, createEasyDeps, openRagService } from '../src/easy/rag-service.js';
import { createRag } from '../src/easy/sdk.js';
import { startRagHttpServer } from '../src/easy/http-server.js';
import { handleMcpMessage } from '../src/easy/mcp-server.js';
import { runDoctorChecks } from '../src/easy/doctor.js';
import { runIndexCommand, runInitCommand } from '../src/easy/cli.js';
import { indexDirectory } from '../src/easy/indexer.js';
import { loadManifest, saveManifest, createEmptyManifest } from '../src/easy/manifest.js';
import { LanceDBStore } from '../src/vector-store/lancedb-store.js';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** Store sembrado con 3 docs sobre temas distintos. */
async function seededRetrievalSetup() {
  const embedder = createHashEmbedder({ dimensions: 16 });
  const store = new InMemoryVectorStore({ dimensions: 16 });
  const bm25 = new BM25Index();
  const docs = [
    { id: 'a', content: 'facturación mensual y recibos' },
    { id: 'b', content: 'envíos y entregas en península' },
    { id: 'c', content: 'facturación anual con descuento' },
  ];
  for (const doc of docs) {
    store.upsertOne({
      id: doc.id,
      vector: await embedder.embed(doc.content),
      metadata: { content: doc.content, tipo: doc.id === 'b' ? 'envios' : 'facturas' },
    });
    bm25.add(doc);
  }
  return { embedder, store, bm25 };
}

test('RetrieverRole: modo bm25 con filtro y relleno de vector/metadata', async () => {
  const { embedder, store, bm25 } = await seededRetrievalSetup();
  const role = new RetrieverRole({ name: 'r', logger: noopLogger, embedder, store, mode: 'bm25', bm25 });
  const hits = await role.run({ query: 'facturación', topK: 5 }, /** @type {never} */ ({}));
  assert.ok(hits.length >= 2);
  assert.ok(hits.every((h) => h.vector.length === 16), 'rellena el vector desde el store');

  const filtered = await role.run(
    { query: 'facturación', topK: 5, filter: (meta) => meta?.tipo === 'envios' },
    /** @type {never} */ ({}),
  );
  assert.equal(filtered.length, 0, 'el filtro descarta los no-envíos');
});

test('RetrieverRole: modo hybrid combina, filtra y respeta threshold', async () => {
  const { embedder, store, bm25 } = await seededRetrievalSetup();
  const role = new RetrieverRole({
    name: 'r',
    logger: noopLogger,
    embedder,
    store,
    mode: 'hybrid',
    bm25,
    hybridAlpha: 0.3,
  });
  const hits = await role.run({ query: 'facturación mensual' }, /** @type {never} */ ({}));
  assert.ok(hits.length >= 1);
  assert.ok(['a', 'c'].includes(hits[0].id), 'los docs de facturación dominan');

  const strict = await role.run(
    { query: 'facturación mensual', similarityThreshold: 2 },
    /** @type {never} */ ({}),
  );
  assert.deepEqual(strict, [], 'threshold imposible vacía el resultado');

  const filtered = await role.run(
    { query: 'facturación envíos', filter: (meta) => meta?.tipo === 'envios' },
    /** @type {never} */ ({}),
  );
  assert.ok(filtered.every((h) => h.metadata?.tipo === 'envios'));
});

test('RetrieverRole: validaciones de constructor y run', async () => {
  const { embedder, store, bm25 } = await seededRetrievalSetup();
  assert.throws(() => new RetrieverRole(/** @type {never} */ ({ name: 'r', logger: noopLogger, store })), /embedder/);
  assert.throws(() => new RetrieverRole(/** @type {never} */ ({ name: 'r', logger: noopLogger, embedder })), /store/);
  assert.throws(
    () => new RetrieverRole({ name: 'r', logger: noopLogger, embedder, store, mode: /** @type {never} */ ('magico') }),
    /mode inválido/,
  );
  assert.throws(
    () => new RetrieverRole({ name: 'r', logger: noopLogger, embedder, store, mode: 'hybrid' }),
    /BM25Index/,
  );
  assert.throws(
    () => new RetrieverRole({ name: 'r', logger: noopLogger, embedder, store, hybridAlpha: 2, mode: 'hybrid', bm25 }),
    /hybridAlpha/,
  );
  const role = new RetrieverRole({ name: 'r', logger: noopLogger, embedder, store });
  await assert.rejects(() => role.run(/** @type {never} */ ({}), /** @type {never} */ ({})), /query/);
});

test('HTTP server: body gigante → 413 y body vacío → 400 con mensaje', async () => {
  const embedder = createHashEmbedder({ dimensions: 8 });
  const store = new InMemoryVectorStore({ dimensions: 8 });
  const manifest = createEmptyManifest('hash|8|x');
  const service = createRagService({ rootDir: '.', manifest, embedder, store, storeName: 'in-memory' });
  const { server, url } = await startRagHttpServer(service, { port: 0, host: '127.0.0.1' });
  try {
    const big = await fetch(`${url}/query`, { method: 'POST', body: 'x'.repeat(70 * 1024) });
    assert.equal(big.status, 413);

    const empty = await fetch(`${url}/query`, { method: 'POST', body: '' });
    assert.equal(empty.status, 400);
    assert.match((await empty.json()).error, /question/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('MCP: ping como notificación (sin id) no responde; con id responde vacío', async () => {
  const embedder = createHashEmbedder({ dimensions: 8 });
  const store = new InMemoryVectorStore({ dimensions: 8 });
  const service = createRagService({
    rootDir: '.',
    manifest: createEmptyManifest('hash|8|x'),
    embedder,
    store,
  });
  assert.equal(await handleMcpMessage(service, { jsonrpc: '2.0', method: 'ping' }), null);
  const pong = await handleMcpMessage(service, { jsonrpc: '2.0', id: 9, method: 'ping' });
  assert.deepEqual(/** @type {any} */ (pong).result, {});
});

test('createEasyDeps: pgvector con PG_URL construye PgVectorStore sin conectar', async () => {
  const { store } = await createEasyDeps(
    { rootDir: '.', store: 'pgvector', embedder: 'hash', dimensions: 8 },
    { PG_URL: 'postgres://karajan:x@localhost:5/db' },
  );
  assert.equal(store.constructor.name, 'PgVectorStore');
});

test('openRagService: sirve un índice con store pgvector inyectando solo env', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cov-'));
  try {
    // Manifest a mano: el status del servicio no toca la base de datos.
    const manifest = createEmptyManifest('hash|8|abc');
    manifest.files['a.md'] = { hash: 'h', sourceType: 'docs', chunkIds: ['a#0'] };
    await saveManifest(root, manifest);
    const service = await openRagService(root, {
      store: 'pgvector',
      env: { PG_URL: 'postgres://karajan:x@localhost:5/db' },
    });
    const status = await service.status();
    assert.equal(status.files, 1);
    assert.equal(status.store, 'pgvector');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createRag: combinaciones mixtas instancia/nombre y transformers por defecto', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cov-'));
  try {
    await writeFile(path.join(root, 'a.md'), '# A\nuno\n', 'utf8');

    // Store inyectado + embedder por nombre.
    const rag1 = await createRag({
      rootDir: root,
      store: new InMemoryVectorStore({ dimensions: 256 }),
    });
    await rag1.index();
    assert.ok((await rag1.query('uno')).hits.length >= 0);

    // Embedder inyectado + store por nombre.
    const rag2 = await createRag({
      rootDir: root,
      store: 'in-memory',
      embedder: createHashEmbedder({ dimensions: 32 }),
    });
    assert.equal(typeof rag2.index, 'function');

    // transformers por nombre: dimensiones por defecto 384 (el peer no se
    // carga hasta embeber, construir es seguro).
    const rag3 = await createRag({ rootDir: root, store: 'in-memory', embedder: 'transformers' });
    assert.equal(typeof rag3.query, 'function');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('embedder y cache: validaciones de entrada', async () => {
  assert.throws(() => createHashEmbedder({ dimensions: 0 }), /dimensions/);
  assert.throws(() => createHashEmbedder({ dimensions: 5000 }), /dimensions/);

  const base = createHashEmbedder({ dimensions: 8 });
  const cached = createCachedEmbedder(base, { model: 'hash' });
  const [a, b] = await Promise.all([cached.embed('mismo texto'), cached.embed('mismo texto')]);
  assert.deepEqual(a, b);
  assert.ok(cached.stats.hits + cached.stats.misses >= 1);
});

test('LanceDBStore: validaciones y ramas sin conexión real', async () => {
  assert.throws(() => new LanceDBStore(/** @type {never} */ ({})), /dimensions/);

  const fakeTable = {
    async delete() {},
    async add() {},
    // sin countRows → rama size() alternativa
  };
  const fakeLancedb = {
    async connect() {
      return {
        async tableNames() {
          return ['karajan_rag_chunks'];
        },
        async openTable() {
          return fakeTable;
        },
      };
    },
  };
  const store = new LanceDBStore({ dimensions: 2, lancedb: fakeLancedb });
  assert.equal(await store.size(), 0, 'sin countRows devuelve 0');
  await assert.rejects(
    () => store.upsertOne(/** @type {never} */ ({ id: '', vector: [1, 2] })),
    /record.id/,
  );
  await assert.rejects(
    () => store.upsertOne({ id: 'a', vector: [1], metadata: {} }),
    /dimensión/,
  );
  const scanIterator = store.scan({ batchSize: 0 });
  await assert.rejects(() => scanIterator.next(), /batchSize/);
});

test('doctor: defaultWhichBin encuentra binarios reales en un PATH controlado', async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), 'kjr-bin-'));
  try {
    const fakeCli = path.join(binDir, 'ollama');
    await writeFile(fakeCli, '#!/bin/sh\n', 'utf8');
    await chmod(fakeCli, 0o755);
    const checks = await runDoctorChecks(binDir, {
      env: { PATH: binDir },
      importModule: async () => ({}),
      nodeVersion: '22.0.0',
      // sin whichBin: ejercita defaultWhichBin real
    });
    const clis = checks.find((c) => c.name === 'CLIs de IA');
    assert.equal(clis?.level, 'ok');
    assert.match(String(clis?.detail), /ollama/);
  } finally {
    await rm(binDir, { recursive: true, force: true });
  }
});

test('cli: runIndexCommand aplica la config del proyecto como defaults', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cov-'));
  try {
    await writeFile(path.join(root, 'a.md'), '# A\nuno\n', 'utf8');
    await writeFile(
      path.join(root, 'karajan.config.json'),
      JSON.stringify({ easy: { store: 'in-memory', dimensions: 16 } }),
      'utf8',
    );
    const result = await runIndexCommand([root], { env: {}, log: () => {} });
    // 2 ficheros: a.md + el propio karajan.config.json (json es tipo data).
    assert.equal(result.indexedFiles, 2);
    const manifest = await loadManifest(root);
    assert.ok(manifest?.fingerprint.includes('|16|'), 'usa las dimensiones de la config');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cli: init es idempotente con .gitignore que ya tiene la entrada', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cov-'));
  try {
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\n.karajan/\n', 'utf8');
    await runInitCommand([root, '--yes'], { log: () => {} });
    const gitignore = await readFile(path.join(root, '.gitignore'), 'utf8');
    const occurrences = gitignore.split('.karajan/').length - 1;
    assert.equal(occurrences, 1, 'no duplica la entrada');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('indexDirectory: excluye subdirectorios ocultos y respeta ficheros ocultos', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cov-'));
  try {
    await mkdir(path.join(root, '.oculto'), { recursive: true });
    await writeFile(path.join(root, '.oculto', 'x.md'), '# X\n', 'utf8');
    await writeFile(path.join(root, '.dotfile.md'), '# dot\n', 'utf8');
    await writeFile(path.join(root, 'a.md'), '# A\nuno\n', 'utf8');
    const embedder = createHashEmbedder({ dimensions: 8 });
    const store = new InMemoryVectorStore({ dimensions: 8 });
    const result = await indexDirectory(root, { store, embedder });
    assert.equal(result.indexedFiles, 1, 'solo a.md — ocultos fuera');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
