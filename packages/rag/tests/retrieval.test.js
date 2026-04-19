// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { RetrieverRole } from '../src/retrieval/retriever-role.js';
import { RerankerRole } from '../src/retrieval/reranker-role.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

async function buildRetriever(corpus = ['perro', 'gato', 'coche', 'manzana']) {
  const embedder = createHashEmbedder({ dimensions: 32 });
  const store = new InMemoryVectorStore({ dimensions: 32 });
  for (const t of corpus) {
    store.upsertOne({ id: t, vector: await embedder.embed(t), metadata: { content: t } });
  }
  const role = new RetrieverRole({
    name: 'retriever',
    logger: silentLogger(),
    embedder,
    store,
    defaultTopK: 3,
  });
  return role;
}

test('RetrieverRole: devuelve top-K ordenado y con score', async () => {
  const role = await buildRetriever();
  const hits = await role.run({ query: 'perro' }, { get: () => null, has: () => false });
  assert.equal(hits.length, 3);
  assert.equal(hits[0].id, 'perro');
  assert.ok(hits[0].score >= hits[1].score);
});

test('RetrieverRole: input.topK sobrescribe defaultTopK', async () => {
  const role = await buildRetriever();
  const hits = await role.run({ query: 'x', topK: 1 }, { get: () => null, has: () => false });
  assert.equal(hits.length, 1);
});

test('RetrieverRole: query vacía o ausente lanza', async () => {
  const role = await buildRetriever();
  await assert.rejects(
    () => role.run({ query: '' }, { get: () => null, has: () => false }),
    /input\.query/,
  );
});

test('RerankerRole score: ordena por score descendente', async () => {
  const role = new RerankerRole({ name: 'rr', logger: silentLogger(), mode: 'score' });
  const input = {
    query: 'x',
    hits: [
      { id: 'a', score: 0.3, vector: [] },
      { id: 'b', score: 0.9, vector: [] },
      { id: 'c', score: 0.5, vector: [] },
    ],
  };
  const out = await role.run(input, { get: () => null, has: () => false });
  assert.deepEqual(out.map((h) => h.id), ['b', 'c', 'a']);
});

test('RerankerRole llm: usa el ranking devuelto por el adapter', async () => {
  const fakeAdapter = async () => ({
    provider: 'fake',
    process: { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false },
    parsedOutput: {
      format: 'json',
      json: { ranking: ['c', 'a', 'b'] },
      text: '',
    },
  });
  const role = new RerankerRole({
    name: 'rr',
    logger: silentLogger(),
    mode: 'llm',
    adapter: fakeAdapter,
  });
  const input = {
    query: 'x',
    hits: [
      { id: 'a', score: 0.3, vector: [] },
      { id: 'b', score: 0.5, vector: [] },
      { id: 'c', score: 0.2, vector: [] },
    ],
  };
  const out = await role.run(input, { get: () => null, has: () => false });
  assert.deepEqual(out.map((h) => h.id), ['c', 'a', 'b']);
});

test('RerankerRole llm: hits no mencionados por el LLM se añaden al final', async () => {
  const fakeAdapter = async () => ({
    provider: 'fake',
    process: { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false },
    parsedOutput: { format: 'json', json: { ranking: ['a'] }, text: '' },
  });
  const role = new RerankerRole({
    name: 'rr',
    logger: silentLogger(),
    mode: 'llm',
    adapter: fakeAdapter,
  });
  const input = {
    query: 'x',
    hits: [
      { id: 'a', score: 0.1, vector: [] },
      { id: 'b', score: 0.2, vector: [] },
    ],
  };
  const out = await role.run(input, { get: () => null, has: () => false });
  assert.deepEqual(out.map((h) => h.id), ['a', 'b']);
});

test('RerankerRole llm: sin adapter inyectado y sin tools registrados lanza', async () => {
  const role = new RerankerRole({ name: 'rr', logger: silentLogger(), mode: 'llm' });
  await assert.rejects(
    () => role.run({ query: 'x', hits: [] }, { get: () => null, has: () => false }),
    /no hay adapter/,
  );
});

test('RerankerRole: mode inválido lanza en constructor', () => {
  // @ts-expect-error valor inválido
  assert.throws(() => new RerankerRole({ name: 'r', logger: silentLogger(), mode: 'wtf' }), /mode/);
});
