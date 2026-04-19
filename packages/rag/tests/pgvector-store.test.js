// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PgVectorStore } from '../src/vector-store/pgvector-store.js';

/**
 * Mock client que registra las queries y devuelve respuestas configuradas.
 */
function makeMockClient(responseQueue) {
  const queries = [];
  return {
    queries,
    client: {
      async query(text, params) {
        queries.push({ text, params });
        const next = responseQueue.shift();
        if (next) return next;
        return { rows: [], rowCount: 0 };
      },
    },
  };
}

test('PgVectorStore: constructor valida args', () => {
  assert.throws(
    // @ts-expect-error missing dimensions
    () => new PgVectorStore({ connectionString: 'postgres://localhost' }),
    /dimensions/,
  );
  assert.throws(
    // @ts-expect-error missing client + connectionString
    () => new PgVectorStore({ dimensions: 128 }),
    /client.*connectionString/,
  );
});

test('PgVectorStore: upsertOne envía INSERT ON CONFLICT DO UPDATE', async () => {
  const mock = makeMockClient([{ rows: [], rowCount: 1 }]);
  const store = new PgVectorStore({
    client: mock.client,
    dimensions: 4,
  });
  await store.upsertOne({
    id: 'abc',
    vector: [0.1, 0.2, 0.3, 0.4],
    metadata: { source: 'file.md', chunk_index: 0, content: 'hola' },
  });
  assert.equal(mock.queries.length, 1);
  assert.match(mock.queries[0].text, /ON CONFLICT \(id\) DO UPDATE/);
  assert.equal(mock.queries[0].params[0], 'abc');
  assert.equal(mock.queries[0].params[4], '[0.1,0.2,0.3,0.4]');
});

test('PgVectorStore: upsertOne valida dimensión', async () => {
  const mock = makeMockClient([]);
  const store = new PgVectorStore({ client: mock.client, dimensions: 3 });
  await assert.rejects(
    () => store.upsertOne({ id: 'x', vector: [1, 2] }),
    /dimensi\u00f3n 3/,
  );
});

test('PgVectorStore: search construye query con <=> y mapea score', async () => {
  const mock = makeMockClient([
    {
      rows: [
        { id: 'a', embedding: '[1,0,0]', metadata: { x: 1 }, score: 0.9 },
        { id: 'b', embedding: '[0,1,0]', metadata: { x: 2 }, score: 0.7 },
      ],
      rowCount: 2,
    },
  ]);
  const store = new PgVectorStore({ client: mock.client, dimensions: 3 });
  const hits = await store.search([1, 0, 0], { topK: 2 });
  assert.match(mock.queries[0].text, /embedding <=>/);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].id, 'a');
  assert.equal(hits[0].score, 0.9);
  assert.deepEqual(hits[0].vector, [1, 0, 0]);
});

test('PgVectorStore: search filter se aplica sobre metadata', async () => {
  const mock = makeMockClient([
    {
      rows: [
        { id: 'a', embedding: '[1,0]', metadata: { lang: 'es' }, score: 0.9 },
        { id: 'b', embedding: '[1,0]', metadata: { lang: 'en' }, score: 0.8 },
      ],
      rowCount: 2,
    },
  ]);
  const store = new PgVectorStore({ client: mock.client, dimensions: 2 });
  const hits = await store.search([1, 0], {
    topK: 5,
    filter: (meta) => meta?.lang === 'es',
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'a');
});

test('PgVectorStore: size devuelve count de la BD', async () => {
  const mock = makeMockClient([{ rows: [{ c: 42 }], rowCount: 1 }]);
  const store = new PgVectorStore({ client: mock.client, dimensions: 2 });
  const n = await store.size();
  assert.equal(n, 42);
  assert.match(mock.queries[0].text, /COUNT\(\*\)/);
});

test('PgVectorStore: delete devuelve true si rowCount > 0', async () => {
  const mock = makeMockClient([
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 0 },
  ]);
  const store = new PgVectorStore({ client: mock.client, dimensions: 2 });
  assert.equal(await store.delete('x'), true);
  assert.equal(await store.delete('y'), false);
});

test('PgVectorStore: upsert itera upsertOne', async () => {
  const mock = makeMockClient([
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ]);
  const store = new PgVectorStore({ client: mock.client, dimensions: 2 });
  await store.upsert([
    { id: 'a', vector: [1, 0] },
    { id: 'b', vector: [0, 1] },
  ]);
  assert.equal(mock.queries.length, 2);
});

test('migrations/001-init-pgvector.sql: existe y es idempotente (IF NOT EXISTS)', () => {
  const sqlPath = path.resolve('migrations/001-init-pgvector.sql');
  assert.ok(existsSync(sqlPath), 'fichero de migración debe existir');
  const sql = readFileSync(sqlPath, 'utf8');
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS karajan_rag_chunks/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS karajan_rag_chunks_embedding_hnsw/);
  assert.match(sql, /USING hnsw/);
});

test('docker-compose.yml: declara servicio pgvector con imagen oficial', () => {
  const ymlPath = path.resolve('docker-compose.yml');
  assert.ok(existsSync(ymlPath));
  const yml = readFileSync(ymlPath, 'utf8');
  assert.match(yml, /pgvector\/pgvector:pg16/);
  assert.match(yml, /5432:5432/);
  assert.match(yml, /migrations:/);
});
