// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RetrieverRole } from '../src/retrieval/retriever-role.js';
import { createBM25Index } from '../src/retrieval/bm25.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { dedupeChunksByOverlap } from '../src/retrieval/chunk-dedupe.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

async function buildWorld(corpus) {
  const embedder = createHashEmbedder({ dimensions: 32 });
  const store = new InMemoryVectorStore({ dimensions: 32 });
  const bm25 = createBM25Index();
  for (const { id, content } of corpus) {
    const vector = await embedder.embed(content);
    store.upsertOne({ id, vector, metadata: { content } });
    bm25.add({ id, content });
  }
  return { embedder, store, bm25 };
}

test('RetrieverRole vector mode: sigue funcionando tras extensión', async () => {
  const { embedder, store } = await buildWorld([
    { id: 'a', content: 'gato blanco' },
    { id: 'b', content: 'perro grande' },
  ]);
  const role = new RetrieverRole({
    name: 'r',
    logger: silentLogger(),
    embedder,
    store,
    defaultTopK: 2,
    mode: 'vector',
  });
  const hits = await role.run({ query: 'gato blanco' }, { get: () => null, has: () => false });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].id, 'a');
});

test('RetrieverRole bm25 mode: requiere bm25 en constructor', () => {
  const embedder = createHashEmbedder({ dimensions: 16 });
  const store = new InMemoryVectorStore({ dimensions: 16 });
  assert.throws(
    () => new RetrieverRole({ name: 'r', logger: silentLogger(), embedder, store, mode: 'bm25' }),
    /requiere una instancia BM25Index/,
  );
});

test('RetrieverRole hybrid: alpha=1 equivale a vector-only', async () => {
  // Usa un embedder fake con vectores controlados: query matchea exactamente
  // el vector del doc 'gato'. Así el ranking vectorial es determinista.
  const fakeEmbedder = {
    dimensions: 3,
    async embed(text) {
      const m = {
        gato: [1, 0, 0],
        perro: [0, 1, 0],
        lejano: [0, 0, 1],
        q: [1, 0, 0],
      };
      return m[text] ?? [0, 0, 0];
    },
    async embedBatch(xs) {
      return Promise.all(xs.map((x) => this.embed(x)));
    },
  };
  const store = new InMemoryVectorStore({ dimensions: 3 });
  store.upsertOne({ id: 'gato', vector: [1, 0, 0], metadata: { content: 'gato' } });
  store.upsertOne({ id: 'perro', vector: [0, 1, 0], metadata: { content: 'perro' } });
  store.upsertOne({ id: 'lejano', vector: [0, 0, 1], metadata: { content: 'lejano' } });

  const bm25 = createBM25Index();
  bm25.addAll([
    { id: 'gato', content: 'gato' },
    { id: 'perro', content: 'perro' },
    { id: 'lejano', content: 'lejano' },
  ]);

  const role = new RetrieverRole({
    name: 'r',
    logger: silentLogger(),
    embedder: fakeEmbedder,
    store,
    bm25,
    mode: 'hybrid',
    hybridAlpha: 1.0,
    defaultTopK: 2,
  });
  const hits = await role.run({ query: 'q' }, { get: () => null, has: () => false });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].id, 'gato');
});

test('RetrieverRole hybrid: alpha=0 da peso total a BM25', async () => {
  // Con alpha=0, vector score se ignora: solo gana quien mejor matchea el término.
  const fakeEmbedder = {
    dimensions: 3,
    async embed() {
      return [0.33, 0.33, 0.33]; // score vectorial igual para todos
    },
    async embedBatch(xs) {
      return xs.map(() => [0.33, 0.33, 0.33]);
    },
  };
  const store = new InMemoryVectorStore({ dimensions: 3 });
  store.upsertOne({ id: 'a', vector: [1, 0, 0], metadata: { content: 'gato gato gato' } });
  store.upsertOne({ id: 'b', vector: [0, 1, 0], metadata: { content: 'perro perro' } });
  store.upsertOne({ id: 'c', vector: [0, 0, 1], metadata: { content: 'cualquier otra cosa' } });
  const bm25 = createBM25Index();
  bm25.addAll([
    { id: 'a', content: 'gato gato gato' },
    { id: 'b', content: 'perro perro' },
    { id: 'c', content: 'cualquier otra cosa' },
  ]);
  const role = new RetrieverRole({
    name: 'r',
    logger: silentLogger(),
    embedder: fakeEmbedder,
    store,
    bm25,
    mode: 'hybrid',
    hybridAlpha: 0,
    defaultTopK: 2,
  });
  const hits = await role.run({ query: 'gato' }, { get: () => null, has: () => false });
  assert.equal(hits[0].id, 'a');
});

test('RetrieverRole hybrid: alpha=0.5 combina ambos rankings', async () => {
  const { embedder, store, bm25 } = await buildWorld([
    { id: 'vector-wins', content: 'gato blanco' },
    { id: 'keyword-wins', content: 'otra frase pero con gato gato gato repetido' },
    { id: 'neutral', content: 'nada similar' },
  ]);
  const role = new RetrieverRole({
    name: 'r',
    logger: silentLogger(),
    embedder,
    store,
    bm25,
    mode: 'hybrid',
    hybridAlpha: 0.5,
    defaultTopK: 3,
  });
  const hits = await role.run({ query: 'gato' }, { get: () => null, has: () => false });
  assert.ok(hits.length >= 2);
  const ids = hits.map((h) => h.id);
  assert.ok(ids.includes('vector-wins') || ids.includes('keyword-wins'));
});

test('RetrieverRole: similarityThreshold filtra los bajos', async () => {
  const { embedder, store } = await buildWorld([
    { id: 'target', content: 'la respuesta exacta' },
    { id: 'other', content: 'otro tema completamente diferente' },
  ]);
  const role = new RetrieverRole({
    name: 'r',
    logger: silentLogger(),
    embedder,
    store,
    mode: 'vector',
    defaultTopK: 5,
    similarityThreshold: 0.99, // casi imposible
  });
  const hits = await role.run(
    { query: 'la respuesta exacta' },
    { get: () => null, has: () => false },
  );
  assert.ok(hits.every((h) => h.score >= 0.99));
});

test('RetrieverRole: similarityThreshold=0 deja pasar todo', async () => {
  const { embedder, store } = await buildWorld([
    { id: 'a', content: 'uno' },
    { id: 'b', content: 'dos' },
  ]);
  const role = new RetrieverRole({
    name: 'r',
    logger: silentLogger(),
    embedder,
    store,
    mode: 'vector',
    defaultTopK: 5,
    similarityThreshold: 0,
  });
  const hits = await role.run({ query: 'uno' }, { get: () => null, has: () => false });
  assert.equal(hits.length, 2);
});

test('RetrieverRole: hybridAlpha fuera de [0,1] lanza en constructor', () => {
  const embedder = createHashEmbedder({ dimensions: 16 });
  const store = new InMemoryVectorStore({ dimensions: 16 });
  const bm25 = createBM25Index();
  assert.throws(
    () =>
      new RetrieverRole({
        name: 'r',
        logger: silentLogger(),
        embedder,
        store,
        bm25,
        mode: 'hybrid',
        hybridAlpha: 1.5,
      }),
    /hybridAlpha/,
  );
});

test('dedupeChunksByOverlap: elimina hits con overlap >= threshold', () => {
  const hits = [
    { id: 'a', score: 0.9, vector: [], metadata: { content: 'gato blanco pequeño' } },
    { id: 'b', score: 0.7, vector: [], metadata: { content: 'gato blanco pequeño adorable' } },
    { id: 'c', score: 0.6, vector: [], metadata: { content: 'cielo azul despejado' } },
  ];
  const { kept, dropped } = dedupeChunksByOverlap(hits, { threshold: 0.6 });
  const keptIds = kept.map((k) => k.id).sort();
  assert.deepEqual(keptIds, ['a', 'c']);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].dropped, 'b');
  assert.equal(dropped[0].duplicateOf, 'a');
});

test('dedupeChunksByOverlap: nada duplicado deja pasar todo', () => {
  const hits = [
    { id: 'a', score: 0.9, vector: [], metadata: { content: 'uno dos tres' } },
    { id: 'b', score: 0.8, vector: [], metadata: { content: 'cuatro cinco seis' } },
  ];
  const { kept, dropped } = dedupeChunksByOverlap(hits, { threshold: 0.5 });
  assert.equal(kept.length, 2);
  assert.equal(dropped.length, 0);
});

test('dedupeChunksByOverlap: conserva el de mayor score en empates', () => {
  const hits = [
    { id: 'lowscore', score: 0.3, vector: [], metadata: { content: 'texto idéntico' } },
    { id: 'highscore', score: 0.9, vector: [], metadata: { content: 'texto idéntico' } },
  ];
  const { kept, dropped } = dedupeChunksByOverlap(hits);
  assert.equal(kept[0].id, 'highscore');
  assert.equal(dropped[0].dropped, 'lowscore');
});

test('dedupeChunksByOverlap: array vacío → report vacío', () => {
  const { kept, dropped } = dedupeChunksByOverlap([]);
  assert.deepEqual(kept, []);
  assert.deepEqual(dropped, []);
});

test('dedupeChunksByOverlap: threshold fuera de [0,1] lanza', () => {
  assert.throws(() => dedupeChunksByOverlap([], { threshold: 1.5 }), /threshold/);
});
