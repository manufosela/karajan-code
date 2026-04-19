// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCachedEmbedder } from '../src/embedding/embedding-cache.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';

/**
 * Wrapper alrededor de HashEmbedder que cuenta llamadas.
 */
function countingEmbedder(dims = 32, model = 'test-model') {
  const inner = createHashEmbedder({ dimensions: dims });
  let embedCalls = 0;
  let batchCalls = 0;
  return {
    model,
    dimensions: inner.dimensions,
    get embedCalls() {
      return embedCalls;
    },
    get batchCalls() {
      return batchCalls;
    },
    async embed(text) {
      embedCalls += 1;
      return inner.embed(text);
    },
    async embedBatch(texts) {
      batchCalls += 1;
      return inner.embedBatch(texts);
    },
  };
}

test('createCachedEmbedder: segunda llamada con mismo texto usa cache', async () => {
  const base = countingEmbedder();
  const cached = createCachedEmbedder(base, { model: 'test-model' });
  const v1 = await cached.embed('hola');
  const v2 = await cached.embed('hola');
  assert.deepEqual(v1, v2);
  assert.equal(base.embedCalls, 1);
  assert.equal(cached.stats.hits, 1);
  assert.equal(cached.stats.misses, 1);
});

test('createCachedEmbedder: textos distintos son miss', async () => {
  const base = countingEmbedder();
  const cached = createCachedEmbedder(base, { model: 'm' });
  await cached.embed('a');
  await cached.embed('b');
  await cached.embed('a');
  assert.equal(base.embedCalls, 2);
  assert.equal(cached.stats.hits, 1);
  assert.equal(cached.stats.misses, 2);
});

test('createCachedEmbedder: distinto modelo produce keys distintas', async () => {
  const store = new Map();
  const base1 = countingEmbedder(16, 'model-A');
  const base2 = countingEmbedder(16, 'model-B');
  const c1 = createCachedEmbedder(base1, { model: 'model-A', store });
  const c2 = createCachedEmbedder(base2, { model: 'model-B', store });
  await c1.embed('x');
  await c2.embed('x');
  // Ambos calculan porque la key difiere por modelo
  assert.equal(base1.embedCalls, 1);
  assert.equal(base2.embedCalls, 1);
  assert.equal(store.size, 2);
});

test('createCachedEmbedder: distinta dimensión produce keys distintas', async () => {
  const store = new Map();
  const base32 = countingEmbedder(32, 'm');
  const base64 = countingEmbedder(64, 'm');
  const c32 = createCachedEmbedder(base32, { model: 'm', store });
  const c64 = createCachedEmbedder(base64, { model: 'm', store });
  await c32.embed('same');
  await c64.embed('same');
  assert.equal(store.size, 2);
});

test('createCachedEmbedder: embedBatch aprovecha cache parcial', async () => {
  const base = countingEmbedder(8);
  const cached = createCachedEmbedder(base, { model: 'm' });
  await cached.embed('a');
  await cached.embed('b');
  assert.equal(base.embedCalls, 2);
  const vectors = await cached.embedBatch(['a', 'b', 'c']);
  assert.equal(vectors.length, 3);
  // a y b ya estaban en cache → solo 'c' se calcula
  assert.equal(base.batchCalls, 1); // un solo batch call
  assert.equal(cached.stats.hits, 2);
  assert.equal(cached.stats.misses, 3); // 2 iniciales + 1 nuevo
});

test('createCachedEmbedder: embedBatch vacío no llama al base', async () => {
  const base = countingEmbedder();
  const cached = createCachedEmbedder(base, { model: 'm' });
  const result = await cached.embedBatch([]);
  assert.deepEqual(result, []);
  assert.equal(base.embedCalls + base.batchCalls, 0);
});

test('createCachedEmbedder: funciona con CacheStore custom async', async () => {
  /** @type {Record<string, number[]>} */
  const backing = {};
  const store = {
    async get(k) {
      return backing[k];
    },
    async set(k, v) {
      backing[k] = v;
    },
  };
  const base = countingEmbedder(8);
  const cached = createCachedEmbedder(base, { model: 'm', store });
  const v1 = await cached.embed('x');
  const v2 = await cached.embed('x');
  assert.deepEqual(v1, v2);
  assert.equal(base.embedCalls, 1);
  assert.equal(Object.keys(backing).length, 1);
});

test('createCachedEmbedder: rechaza base sin embed', () => {
  // @ts-expect-error invalid
  assert.throws(() => createCachedEmbedder(null), /baseEmbedder/);
  // @ts-expect-error invalid
  assert.throws(() => createCachedEmbedder({}), /baseEmbedder/);
});

test('createCachedEmbedder: stats expone size si el store es Map', async () => {
  const base = countingEmbedder(8);
  const cached = createCachedEmbedder(base, { model: 'm' });
  assert.equal(cached.stats.size, 0);
  await cached.embed('alpha');
  assert.equal(cached.stats.size, 1);
  await cached.embed('beta');
  assert.equal(cached.stats.size, 2);
  await cached.embed('alpha');
  assert.equal(cached.stats.size, 2, 'hit no incrementa size');
});

test('createCachedEmbedder: stats.size es undefined si el store no expone size', async () => {
  const base = countingEmbedder(8);
  const store = {
    async get(k) { return this._m.get(k); },
    async set(k, v) { this._m.set(k, v); },
    _m: new Map(),
  };
  const cached = createCachedEmbedder(base, { model: 'm', store });
  await cached.embed('x');
  assert.equal(cached.stats.size, undefined);
});

test('createCachedEmbedder: stats.evictions refleja onEviction() externo', async () => {
  const base = countingEmbedder(8);
  const cached = createCachedEmbedder(base, { model: 'm' });
  assert.equal(cached.stats.evictions, 0);
  cached.onEviction();
  cached.onEviction();
  cached.onEviction();
  assert.equal(cached.stats.evictions, 3);
  // evictions es independiente de hits/misses
  assert.equal(cached.stats.hits, 0);
  assert.equal(cached.stats.misses, 0);
});

test('createCachedEmbedder: stats inicial tiene hits/misses/evictions=0 y size=0', async () => {
  const base = countingEmbedder(8);
  const cached = createCachedEmbedder(base, { model: 'm' });
  assert.equal(cached.stats.hits, 0);
  assert.equal(cached.stats.misses, 0);
  assert.equal(cached.stats.evictions, 0);
  assert.equal(cached.stats.size, 0);
});
