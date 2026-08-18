// @ts-check
/**
 * Tercera ronda de tests dirigidos a ramas (KJR-TSK-0128).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { createOpenAICompatibleEmbedder } from '../src/embedding/openai-compatible-embedder.js';
import { tokenize, BM25Index, createBM25Index } from '../src/retrieval/bm25.js';
import { dedupeChunksByOverlap } from '../src/retrieval/chunk-dedupe.js';
import { RerankerRole } from '../src/retrieval/reranker-role.js';
import { RedactionRole } from '../src/redaction/redaction-role.js';
import {
  faithfulness,
  contextPrecision,
  answerRelevance,
} from '../src/evaluation/local-metrics.js';
import { loadGoldenSet } from '../src/evaluation/golden-runner.js';
import { computeIndexFingerprint } from '../src/easy/manifest.js';
import { validatePipelineConfig } from '../src/config/pipeline-config.js';
import { buildPipelineFromConfig } from '../src/config/pipeline-builder.js';
import { RoleRegistry } from '../src/pipeline/role-registry.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { PgVectorStore } from '../src/vector-store/pgvector-store.js';
import { LanceDBStore } from '../src/vector-store/lancedb-store.js';
import { queryIndex } from '../src/easy/query.js';
import { handleMcpMessage } from '../src/easy/mcp-server.js';
import { createRagService } from '../src/easy/rag-service.js';
import { createEmptyManifest } from '../src/easy/manifest.js';
import { runDoctorCommand } from '../src/easy/doctor.js';
import { startRagHttpServer } from '../src/easy/http-server.js';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

test('hash embedder: defaults sin opciones y entradas null', async () => {
  const embedder = createHashEmbedder();
  assert.equal(embedder.dimensions, 64);
  const vector = await embedder.embed(/** @type {never} */ (null));
  assert.equal(vector.length, 64);
  const batch = await embedder.embedBatch([/** @type {never} */ (null), 'x']);
  assert.equal(batch.length, 2);
});

test('openai-compatible embedder: error HTTP y payload sin data', async () => {
  const bad = createOpenAICompatibleEmbedder({
    baseUrl: 'http://x',
    model: 'm',
    dimensions: 4,
    fetchImpl: /** @type {never} */ (async () => ({
      ok: false,
      status: 500,
      statusText: 'boom',
      text: async () => 'error interno',
    })),
  });
  await assert.rejects(() => bad.embed('x'), /500/);

  const weird = createOpenAICompatibleEmbedder({
    baseUrl: 'http://x',
    model: 'm',
    dimensions: 4,
    fetchImpl: /** @type {never} */ (async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ otra: 'cosa' }),
      json: async () => ({ otra: 'cosa' }),
    })),
  });
  await assert.rejects(() => weird.embed('x'), /data/);
});

test('bm25: entradas degeneradas y factory con opciones', () => {
  assert.deepEqual(tokenize(/** @type {never} */ (null)), []);
  const index = new BM25Index();
  assert.throws(() => index.add(/** @type {never} */ (null)), /doc.id/);
  index.add({ id: 'a', content: /** @type {never} */ (null) });
  assert.deepEqual(index.score('algo'), [], 'doc sin contenido no matchea');
  assert.deepEqual(index.score(''), [], 'query vacía → []');
  assert.equal(index.avgLength(), 0);

  const custom = createBM25Index({ k1: 2, b: 0.5 });
  assert.equal(custom.k1, 2);
  assert.equal(custom.b, 0.5);
});

test('dedupe: tokenizer con content nulo, duplicados reportados y threshold default', () => {
  const twin = 'texto idéntico repetido para forzar solape completo';
  const { kept, dropped } = dedupeChunksByOverlap([
    { id: 'a', score: 0.9, vector: [], metadata: { content: twin } },
    { id: 'b', score: 0.5, vector: [], metadata: { content: twin } },
    { id: 'c', score: 0.4, vector: [], metadata: {} }, // sin content → tokeniza el id
  ]);
  assert.deepEqual(kept.map((h) => h.id), ['a', 'c']);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].duplicateOf, 'a');
});

test('reranker llm: adapter inyectado, ids desconocidos y adapter ausente', async () => {
  const hits = [
    { id: 'x', score: 0.1, vector: [], metadata: { content: 'uno' } },
    { id: 'y', score: 0.9, vector: [], metadata: { content: 'dos' } },
  ];
  const role = new RerankerRole({
    name: 'r',
    logger: noopLogger,
    mode: 'llm',
    adapter: async () => ({
      parsedOutput: { json: { ranking: ['y', 'fantasma'] } },
    }),
  });
  const reordered = await role.run({ query: 'q', hits }, /** @type {never} */ ({}));
  assert.deepEqual(reordered.map((h) => h.id), ['y', 'x'], 'ids no listados se añaden al final');

  const orphan = new RerankerRole({ name: 'r', logger: noopLogger, mode: 'llm' });
  await assert.rejects(
    () => orphan.run({ query: 'q', hits }, /** @type {never} */ ({ has: () => false, get: () => null })),
    /adapter/,
  );
  await assert.rejects(() => orphan.run(/** @type {never} */ ({}), /** @type {never} */ ({})), /hits/);
});

test('redaction role: valida constructor e input.query', async () => {
  assert.throws(() => new RedactionRole(/** @type {never} */ ({ name: 'red', logger: noopLogger })), /policy/);
  const { createDefaultSensitivityPolicy } = await import('../src/policy/sensitivity-policy.js');
  const role = new RedactionRole({
    name: 'red',
    logger: noopLogger,
    policy: createDefaultSensitivityPolicy(),
    targetProvider: 'ollama',
  });
  await assert.rejects(() => role.run(/** @type {never} */ ({}), /** @type {never} */ ({})), /query/);
});

test('métricas locales: ramas de entradas ausentes', () => {
  assert.equal(faithfulness('respuesta', /** @type {never} */ (undefined)), 0);
  assert.equal(contextPrecision(/** @type {never} */ (undefined), ['a']), 0);
  assert.equal(answerRelevance('', 'respuesta'), 0);
  assert.equal(answerRelevance('de la o', 'respuesta'), 0, 'pregunta solo-stopwords → 0');
});

test('golden runner: fichero ilegible falla con mensaje claro', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kjr-cov3-'));
  try {
    const file = path.join(dir, 'golden.json');
    await writeFile(file, '{rotisimo', 'utf8');
    await assert.rejects(() => loadGoldenSet(file), /JSON inválido/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('manifest: computeIndexFingerprint valida argumentos', () => {
  assert.throws(() => computeIndexFingerprint(/** @type {never} */ ({ dimensions: 8 })), /obligatorios/);
  assert.throws(
    () => computeIndexFingerprint({ embedderName: 'hash', dimensions: -1 }),
    /obligatorios/,
  );
  const withChunking = computeIndexFingerprint({
    embedderName: 'hash',
    dimensions: 8,
    chunkOptions: { maxSize: 100 },
  });
  assert.ok(withChunking.startsWith('hash|8|'));
});

test('pipeline config/builder: formas inválidas y rol no registrado', () => {
  assert.throws(() => validatePipelineConfig(null), /objeto/);
  assert.throws(() => validatePipelineConfig({ name: '' }), /name/);
  assert.throws(() => validatePipelineConfig({ name: 'p', stages: [] }), /stages/);
  assert.throws(() => validatePipelineConfig({ name: 'p', stages: [null] }), /stage\[0\]/);
  assert.throws(() => validatePipelineConfig({ name: 'p', stages: [{ role: '' }] }), /role/);

  const registry = new RoleRegistry();
  assert.throws(
    () => buildPipelineFromConfig({ name: 'p', stages: [{ role: 'inexistente' }] }, registry),
    /no registrado/,
  );
});

test('in-memory store: validaciones de search y upsert', () => {
  const store = new InMemoryVectorStore({ dimensions: 2 });
  assert.throws(() => store.search([1], {}), /dimensión/);
  assert.throws(() => store.upsertOne(/** @type {never} */ ({ id: '', vector: [1, 2] })), /record.id/);
  store.upsertOne({ id: 'a', vector: [1, 0], metadata: { tipo: 'x' } });
  const filtered = store.search([1, 0], { filter: (meta) => meta?.tipo === 'y' });
  assert.deepEqual(filtered, []);
});

test('pgvector: close es seguro con cliente inyectado sin end', async () => {
  const store = new PgVectorStore({ dimensions: 2, client: { async query() { return { rows: [] }; } } });
  await store.close(); // cliente inyectado: no lo cierra ni revienta
  const withEnd = new PgVectorStore({
    dimensions: 2,
    client: { async query() { return { rows: [] }; }, async end() {} },
  });
  await withEnd.close();
});

test('lancedb: upsert en lote y delete que no borra devuelve false', async () => {
  const count = 3;
  const ops = [];
  const fakeTable = {
    async delete(where) {
      ops.push(where);
    },
    async add(rows) {
      ops.push(rows);
    },
    async countRows() {
      return count;
    },
  };
  const store = new LanceDBStore({
    dimensions: 2,
    lancedb: {
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
    },
  });
  await store.upsert([
    { id: 'a', vector: [1, 0], metadata: {} },
    { id: 'b', vector: [0, 1], metadata: {} },
  ]);
  assert.ok(ops.length >= 4, 'delete+add por cada record');
  assert.equal(await store.delete('zombi'), false, 'sin cambio de tamaño → false');
});

test('queryIndex: offset negativo produce line null', async () => {
  const embedder = createHashEmbedder({ dimensions: 8 });
  const store = new InMemoryVectorStore({ dimensions: 8 });
  store.upsertOne({
    id: 'x#0',
    vector: await embedder.embed('texto con offset raro'),
    metadata: { content: 'texto con offset raro', source: 'x.md', offset: -5 },
  });
  const { hits } = await queryIndex('texto raro', {
    rootDir: '.',
    store: /** @type {never} */ (store),
    embedder,
    topK: 1,
  });
  assert.equal(hits[0].line, null);
});

test('mcp: initialize sin params usa la versión de protocolo propia', async () => {
  const service = createRagService({
    rootDir: '.',
    manifest: createEmptyManifest('hash|8|x'),
    embedder: createHashEmbedder({ dimensions: 8 }),
    store: new InMemoryVectorStore({ dimensions: 8 }),
  });
  const res = /** @type {any} */ (
    await handleMcpMessage(service, { jsonrpc: '2.0', id: 1, method: 'initialize' })
  );
  assert.match(res.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);

  const noArgs = /** @type {any} */ (
    await handleMcpMessage(service, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'rag_status' },
    })
  );
  assert.equal(JSON.parse(noArgs.result.content[0].text).files, 0);
});

test('http: body JSON array → 400', async () => {
  const service = createRagService({
    rootDir: '.',
    manifest: createEmptyManifest('hash|8|x'),
    embedder: createHashEmbedder({ dimensions: 8 }),
    store: new InMemoryVectorStore({ dimensions: 8 }),
  });
  const { server, url } = await startRagHttpServer(service, { port: 0, host: '127.0.0.1' });
  try {
    const res = await fetch(`${url}/query`, { method: 'POST', body: '[1,2]' });
    assert.equal(res.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('doctor: rootDir por defecto y env por defecto', async () => {
  const lines = [];
  const { checks } = await runDoctorCommand([], {
    out: (msg) => lines.push(msg),
    deps: {
      importModule: async () => ({}),
      whichBin: async () => false,
      nodeVersion: '22.0.0',
      // sin env: usa process.env (rama por defecto)
    },
  });
  assert.ok(checks.length >= 6);
  assert.ok(lines[0].includes('doctor:'));
});
