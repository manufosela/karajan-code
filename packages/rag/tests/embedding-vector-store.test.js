// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';

test('InMemoryVectorStore: deleteByDocument elimina solo los chunks del documento', async () => {
  const { InMemoryVectorStore } = await import('../src/vector-store/in-memory-vector-store.js');
  const store = new InMemoryVectorStore({ dimensions: 2 });
  store.upsert([
    { id: 'doc:a.md#0', vector: [1, 0], metadata: { documentId: 'doc:a.md' } },
    { id: 'doc:a.md#1', vector: [0, 1], metadata: { documentId: 'doc:a.md' } },
    { id: 'doc:b.md#0', vector: [1, 1], metadata: { documentId: 'doc:b.md' } },
  ]);
  const removed = store.deleteByDocument('doc:a.md');
  assert.equal(removed, 2);
  assert.equal(store.size(), 1);
  assert.equal(store.deleteByDocument('doc:inexistente'), 0);
  assert.throws(() => store.deleteByDocument(''), /documentId/);
});

test('HashEmbedder: embed() es determinista para el mismo texto', async () => {
  const e = createHashEmbedder({ dimensions: 32 });
  const a = await e.embed('hola mundo');
  const b = await e.embed('hola mundo');
  assert.deepEqual(a, b);
});

test('HashEmbedder: textos distintos producen vectores distintos', async () => {
  const e = createHashEmbedder({ dimensions: 32 });
  const a = await e.embed('uno');
  const b = await e.embed('dos');
  assert.notDeepEqual(a, b);
});

test('HashEmbedder: dimensión respeta la config', async () => {
  const e = createHashEmbedder({ dimensions: 128 });
  const v = await e.embed('x');
  assert.equal(v.length, 128);
  assert.equal(e.dimensions, 128);
});

test('HashEmbedder: L2 normaliza (norma ~1)', async () => {
  const e = createHashEmbedder({ dimensions: 64 });
  const v = await e.embed('test');
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9, `norma ${norm}`);
});

test('HashEmbedder: embedBatch devuelve tantos vectores como inputs', async () => {
  const e = createHashEmbedder({ dimensions: 16 });
  const vectors = await e.embedBatch(['a', 'b', 'c']);
  assert.equal(vectors.length, 3);
  assert.equal(vectors[0].length, 16);
});

test('HashEmbedder: dimensions inválidas lanzan', () => {
  assert.throws(() => createHashEmbedder({ dimensions: 0 }), /dimensions/);
  assert.throws(() => createHashEmbedder({ dimensions: -5 }), /dimensions/);
  assert.throws(() => createHashEmbedder({ dimensions: 99999 }), /dimensions/);
});

test('InMemoryVectorStore: upsert + search devuelve el más similar primero', async () => {
  const e = createHashEmbedder({ dimensions: 32 });
  const store = new InMemoryVectorStore({ dimensions: 32 });
  const texts = ['perro', 'gato', 'coche', 'manzana'];
  for (const t of texts) {
    const vector = await e.embed(t);
    store.upsertOne({ id: t, vector });
  }
  const query = await e.embed('perro');
  const hits = store.search(query, { topK: 2 });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].id, 'perro');
  assert.ok(hits[0].score >= hits[1].score);
  // cosine similarity con él mismo debe ser ~1
  assert.ok(Math.abs(hits[0].score - 1) < 1e-9);
});

test('InMemoryVectorStore: topK mayor que N devuelve solo los existentes', async () => {
  const store = new InMemoryVectorStore({ dimensions: 4 });
  store.upsert([
    { id: 'a', vector: [1, 0, 0, 0] },
    { id: 'b', vector: [0, 1, 0, 0] },
  ]);
  const hits = store.search([1, 0, 0, 0], { topK: 10 });
  assert.equal(hits.length, 2);
});

test('InMemoryVectorStore: filter se aplica sobre metadata', () => {
  const store = new InMemoryVectorStore({ dimensions: 2 });
  store.upsert([
    { id: 'a', vector: [1, 0], metadata: { lang: 'es' } },
    { id: 'b', vector: [1, 0], metadata: { lang: 'en' } },
  ]);
  const hits = store.search([1, 0], {
    topK: 10,
    filter: (meta) => meta?.lang === 'es',
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'a');
});

test('InMemoryVectorStore: upsert valida dimensiones y id', () => {
  const store = new InMemoryVectorStore({ dimensions: 3 });
  assert.throws(() => store.upsertOne({ id: 'x', vector: [1, 0] }), /dimensión 3/);
  // @ts-expect-error id vacío
  assert.throws(() => store.upsertOne({ id: '', vector: [0, 0, 0] }), /record.id/);
});

test('InMemoryVectorStore: delete + size funcionan', () => {
  const store = new InMemoryVectorStore({ dimensions: 2 });
  store.upsert([{ id: 'a', vector: [1, 0] }]);
  assert.equal(store.size(), 1);
  assert.equal(store.delete('a'), true);
  assert.equal(store.size(), 0);
  assert.equal(store.delete('a'), false);
});

test('InMemoryVectorStore: constructor valida dimensions', () => {
  // @ts-expect-error missing
  assert.throws(() => new InMemoryVectorStore({}), /dimensions/);
  assert.throws(() => new InMemoryVectorStore({ dimensions: -1 }), /dimensions/);
});
