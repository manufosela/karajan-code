// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBM25Index, BM25Index, tokenize } from '../src/retrieval/bm25.js';

test('tokenize: lowercase alfanumérico y quita diacríticos', () => {
  assert.deepEqual(tokenize('Hola Mundo'), ['hola', 'mundo']);
  assert.deepEqual(tokenize('cómo están los años'), ['como', 'estan', 'los', 'anos']);
  assert.deepEqual(tokenize('a, b; c.d  e!'), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(tokenize(''), []);
});

test('BM25Index: add + size + avgLength', () => {
  const idx = createBM25Index();
  idx.add({ id: 'a', content: 'uno dos tres' });
  idx.add({ id: 'b', content: 'cuatro cinco' });
  assert.equal(idx.size(), 2);
  assert.equal(idx.avgLength(), 2.5);
});

test('BM25Index: documento con la query tiene score mayor', () => {
  const idx = createBM25Index();
  idx.addAll([
    { id: 'cat', content: 'gato blanco pequeño' },
    { id: 'dog', content: 'perro grande marrón' },
    { id: 'fish', content: 'pez rojo diminuto' },
  ]);
  const hits = idx.score('gato');
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].id, 'cat');
  assert.ok(hits[0].score > 0);
});

test('BM25Index: términos frecuentes en todo el corpus tienen IDF menor', () => {
  const idx = createBM25Index();
  idx.addAll([
    { id: 'a', content: 'foo bar baz' },
    { id: 'b', content: 'foo baz qux' },
    { id: 'c', content: 'foo qux' },
  ]);
  // 'foo' aparece en todos → IDF pequeño. 'bar' solo en uno → IDF alto.
  const hitsFoo = idx.score('foo');
  const hitsBar = idx.score('bar');
  assert.ok(hitsBar[0].score > hitsFoo[0].score);
});

test('BM25Index: query con términos ausentes del corpus devuelve vacío', () => {
  const idx = createBM25Index();
  idx.add({ id: 'a', content: 'hola mundo' });
  assert.deepEqual(idx.score('xyz'), []);
});

test('BM25Index: corpus vacío devuelve vacío', () => {
  const idx = createBM25Index();
  assert.deepEqual(idx.score('foo'), []);
});

test('BM25Index: documento con mayor TF del término gana', () => {
  const idx = createBM25Index();
  idx.addAll([
    { id: 'low', content: 'gato algo mas' },
    { id: 'high', content: 'gato gato gato perro' },
  ]);
  const hits = idx.score('gato');
  assert.equal(hits[0].id, 'high');
});

test('BM25Index: documento más largo se penaliza por normalización (b>0)', () => {
  const short = { id: 'short', content: 'gato blanco' };
  const long = {
    id: 'long',
    content: 'gato blanco ' + 'x '.repeat(100),
  };
  const idx = createBM25Index({ b: 0.75 });
  idx.addAll([short, long]);
  const hits = idx.score('gato');
  // El short debe puntuar más alto: misma frecuencia (1), longitud menor.
  assert.equal(hits[0].id, 'short');
});

test('BM25Index: add valida id', () => {
  const idx = createBM25Index();
  // @ts-expect-error invalid
  assert.throws(() => idx.add({ content: 'x' }), /doc\.id/);
});

test('BM25Index: acepta parámetros custom k1 y b', () => {
  const idx = new BM25Index({ k1: 2.0, b: 0.5 });
  idx.add({ id: 'x', content: 'hola mundo' });
  const hits = idx.score('hola');
  assert.ok(hits[0].score > 0);
});
