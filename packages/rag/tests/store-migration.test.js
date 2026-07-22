// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { PgVectorStore } from '../src/vector-store/pgvector-store.js';
import { LanceDBStore } from '../src/vector-store/lancedb-store.js';
import { migrateVectorStore } from '../src/vector-store/migrate.js';

/** @param {number} n */
function seededStore(n) {
  const store = new InMemoryVectorStore({ dimensions: 2 });
  for (let i = 0; i < n; i += 1) {
    store.upsertOne({ id: `doc:a.md#${i}`, vector: [i, 1], metadata: { documentId: 'doc:a.md', i } });
  }
  return store;
}

test('InMemory.scan: lotea todos los records', async () => {
  const store = seededStore(5);
  const batches = [];
  for await (const batch of store.scan({ batchSize: 2 })) batches.push(batch);
  assert.deepEqual(batches.map((b) => b.length), [2, 2, 1]);
});

test('migrateVectorStore: roundtrip completo con fingerprint y progreso', async () => {
  const source = seededStore(7);
  source.setIndexFingerprint('hash|2|abc');
  const target = new InMemoryVectorStore({ dimensions: 2 });
  const progress = [];

  const result = await migrateVectorStore(source, target, {
    batchSize: 3,
    onProgress: (p) => progress.push(p.migrated),
  });
  assert.equal(result.migrated, 7);
  assert.equal(result.batches, 3);
  assert.equal(result.fingerprint, 'hash|2|abc');
  assert.equal(target.size(), 7);
  assert.equal(target.getIndexFingerprint(), 'hash|2|abc');
  assert.deepEqual(progress, [3, 6, 7]);

  // Idempotencia: relanzar no duplica (upsert por id).
  const again = await migrateVectorStore(source, target, { batchSize: 3 });
  assert.equal(again.migrated, 7);
  assert.equal(target.size(), 7);
});

test('migrateVectorStore: dimensiones incompatibles fallan antes de escribir', async () => {
  const source = seededStore(2);
  const target = new InMemoryVectorStore({ dimensions: 8 });
  await assert.rejects(() => migrateVectorStore(source, target), /dimensiones incompatibles/);
  assert.equal(target.size(), 0, 'no se escribió nada');
});

test('migrateVectorStore: destino con otro espacio registrado corta antes de escribir', async () => {
  const source = seededStore(2);
  source.setIndexFingerprint('hash|2|abc');
  const target = new InMemoryVectorStore({ dimensions: 2 });
  target.setIndexFingerprint('transformers|2|zzz');
  await assert.rejects(() => migrateVectorStore(source, target), /ADR-002/);
  assert.equal(target.size(), 0);
});

test('PgVectorStore.scan: pagina con LIMIT/OFFSET y parsea el vector', async () => {
  const queries = [];
  const pages = [
    { rows: [
      { id: 'a#0', embedding: '[1,0]', metadata: { documentId: 'a' } },
      { id: 'a#1', embedding: '[0,1]', metadata: '{"documentId":"a"}' },
    ], rowCount: 2 },
    { rows: [{ id: 'b#0', embedding: '[1,1]', metadata: {} }], rowCount: 1 },
  ];
  const client = {
    async query(text, params) {
      queries.push({ text, params });
      return pages.shift() ?? { rows: [], rowCount: 0 };
    },
  };
  const store = new PgVectorStore({ dimensions: 2, client });
  const all = [];
  for await (const batch of store.scan({ batchSize: 2 })) all.push(...batch);
  assert.equal(all.length, 3);
  assert.deepEqual(all[0].vector, [1, 0]);
  assert.deepEqual(all[1].metadata, { documentId: 'a' });
  assert.match(queries[0].text, /ORDER BY id LIMIT \$1 OFFSET \$2/);
});

test('LanceDBStore.scan: trocea el resultado de query().toArray()', async () => {
  const fakeTable = {
    query() {
      return {
        async toArray() {
          return [
            { id: 'x#0', vector: Float32Array.from([1, 0]), metadata: '{"documentId":"x"}' },
            { id: 'x#1', vector: [0, 1], metadata: '{"documentId":"x"}' },
            { id: 'y#0', vector: [1, 1], metadata: 'rotísimo{' },
          ];
        },
      };
    },
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
  const batches = [];
  for await (const batch of store.scan({ batchSize: 2 })) batches.push(batch);
  assert.deepEqual(batches.map((b) => b.length), [2, 1]);
  assert.deepEqual(batches[0][0].vector, [1, 0]);
  assert.deepEqual(batches[0][0].metadata, { documentId: 'x' });
});
