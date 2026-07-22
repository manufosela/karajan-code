// @ts-check
/**
 * Cuarta ronda de tests dirigidos (KJR-TSK-0128): registries por defecto,
 * ramas de peer ausente y detalles de stores.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDefaultAdapterRegistry } from '../src/ai/adapter-registry.js';
import { createDefaultRoleRegistry } from '../src/registry/default-role-registry.js';
import { createTransformersEmbedder } from '../src/embedding/transformers-embedder.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { LanceDBStore } from '../src/vector-store/lancedb-store.js';
import { RetrieverRole } from '../src/retrieval/retriever-role.js';
import { BM25Index } from '../src/retrieval/bm25.js';
import { loadManifest } from '../src/easy/manifest.js';
import { runDoctorChecks } from '../src/easy/doctor.js';
import { saveEasyConfig } from '../src/easy/config.js';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

test('createDefaultAdapterRegistry: registra los tres CLIs con metadata', async () => {
  const registry = await createDefaultAdapterRegistry();
  for (const name of ['claude', 'codex', 'gemini']) {
    assert.equal(registry.has(name), true);
    assert.equal(typeof registry.get(name), 'function');
    assert.ok(registry.getMeta(name)?.bin, `meta.bin presente para ${name}`);
  }
  assert.deepEqual(registry.list().sort(), ['claude', 'codex', 'gemini']);
});

test('createDefaultRoleRegistry: registra roles según las piezas disponibles', async () => {
  const embedder = createHashEmbedder({ dimensions: 8 });
  const store = new InMemoryVectorStore({ dimensions: 8 });
  const adapterRegistry = await createDefaultAdapterRegistry();
  const registry = createDefaultRoleRegistry({
    embedder,
    store,
    adapterRegistry,
    logger: noopLogger,
  });
  assert.ok(registry.list().length >= 2, `roles: ${registry.list().join(', ')}`);
  for (const name of registry.list()) {
    const role = registry.resolve(name);
    assert.equal(typeof role.run, 'function', `${name} expone run()`);
  }
  assert.throws(() => createDefaultRoleRegistry(/** @type {never} */ ({})), /logger/);
});

test('transformers embedder: peer ausente produce el error instructivo', async () => {
  // Sin loader inyectado usa el defaultLoader → import('@xenova/transformers')
  // que no está instalado en este repo → mensaje con el comando de instalación.
  const embedder = createTransformersEmbedder();
  await assert.rejects(() => embedder.embed('x'), /pnpm add @xenova\/transformers/);
});

test('InMemoryVectorStore.scan: batchSize inválido lanza', async () => {
  const store = new InMemoryVectorStore({ dimensions: 2 });
  const iterator = store.scan({ batchSize: -1 });
  await assert.rejects(() => iterator.next(), /batchSize/);
});

test('LanceDBStore.scan: metadata ya deserializada se respeta', async () => {
  const rows = [{ id: 'a', vector: [1, 0], metadata: { tipo: 'obj' } }];
  const store = new LanceDBStore({
    dimensions: 2,
    lancedb: {
      async connect() {
        return {
          async tableNames() {
            return ['karajan_rag_chunks'];
          },
          async openTable() {
            return {
              query() {
                return { async toArray() { return rows; } };
              },
              async countRows() {
                return 1;
              },
            };
          },
        };
      },
    },
  });
  const batches = [];
  for await (const batch of store.scan()) batches.push(...batch);
  assert.deepEqual(batches[0].metadata, { tipo: 'obj' });
});

test('RetrieverRole: usa store.get() cuando existe para rellenar hits bm25', async () => {
  const embedder = createHashEmbedder({ dimensions: 8 });
  const bm25 = new BM25Index();
  bm25.add({ id: 'a', content: 'facturación mensual' });
  const store = {
    search: () => [],
    get: (id) => (id === 'a' ? { id, score: 0, vector: [9, 9], metadata: { via: 'get' } } : null),
  };
  const role = new RetrieverRole({
    name: 'r',
    logger: noopLogger,
    embedder,
    store: /** @type {never} */ (store),
    mode: 'bm25',
    bm25,
  });
  const hits = await role.run({ query: 'facturación' }, /** @type {never} */ ({}));
  assert.deepEqual(hits[0].vector, [9, 9], 'rellenado vía store.get');
  assert.equal(hits[0].metadata?.via, 'get');
});

test('loadManifest: error de lectura no-ENOENT se propaga', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cov4-'));
  try {
    // manifest.json como DIRECTORIO → readFile falla con EISDIR, no ENOENT.
    await mkdir(path.join(root, '.karajan', 'manifest.json'), { recursive: true });
    await assert.rejects(() => loadManifest(root), /EISDIR|directory/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('adapters HTTP: la apiKey cae al env cuando no viene en opts', async () => {
  const { runOpenAi } = await import('../src/ai/adapters/openai-adapter.js');
  const { runAnthropic } = await import('../src/ai/adapters/anthropic-adapter.js');
  const fetchImpl = /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({ choices: [], content: [] }),
  })));

  const prevOpenAi = process.env.OPENAI_API_KEY;
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-env-openai';
  process.env.ANTHROPIC_API_KEY = 'sk-env-anthropic';
  try {
    const openai = await runOpenAi('h', { fetchImpl });
    assert.equal(openai.process.exitCode, 0);
    const anthropic = await runAnthropic('h', { fetchImpl });
    assert.equal(anthropic.process.exitCode, 0);
  } finally {
    if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAi;
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropic;
  }
});

test('ollama client: respuesta no-JSON cae al texto crudo', async () => {
  const { createOllamaClient } = await import('../src/ai/adapters/ollama-client.js');
  const client = createOllamaClient({
    fetchImpl: /** @type {never} */ (async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'texto plano sin json',
    })),
  });
  const res = await client.adapter('h');
  assert.equal(res.parsedOutput.text, 'texto plano sin json');
});

test('doctor: config válida reporta ok con su contenido', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cov4-'));
  try {
    await saveEasyConfig(root, { store: 'in-memory', dimensions: 8 });
    const checks = await runDoctorChecks(root, {
      env: {},
      importModule: async () => ({}),
      whichBin: async () => false,
      nodeVersion: '22.0.0',
    });
    const config = checks.find((c) => c.name === 'karajan.config.json');
    assert.equal(config?.level, 'ok');
    assert.match(String(config?.detail), /in-memory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
