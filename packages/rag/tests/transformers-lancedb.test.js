// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransformersEmbedder } from '../src/embedding/transformers-embedder.js';
import { LanceDBStore } from '../src/vector-store/lancedb-store.js';

test('createTransformersEmbedder: usa loader inyectado para obtener pipeline', async () => {
  let capturedTask = null;
  let capturedModel = null;
  const fakePipeline = async (_text) => ({
    data: new Array(384).fill(0.1),
  });
  const loader = async (task, model) => {
    capturedTask = task;
    capturedModel = model;
    return fakePipeline;
  };
  const e = createTransformersEmbedder({ loader });
  const v = await e.embed('hola');
  assert.equal(capturedTask, 'feature-extraction');
  assert.equal(capturedModel, 'Xenova/all-MiniLM-L6-v2');
  assert.equal(v.length, 384);
});

test('createTransformersEmbedder: embedBatch resuelve cada texto', async () => {
  const fakePipeline = async (text) => ({
    data: new Array(16).fill(String(text).length / 10),
  });
  const loader = async () => fakePipeline;
  const e = createTransformersEmbedder({ dimensions: 16, loader });
  const vectors = await e.embedBatch(['a', 'bb', 'ccc']);
  assert.equal(vectors.length, 3);
  assert.equal(vectors[0].length, 16);
});

test('createTransformersEmbedder: override model respetado', async () => {
  let capturedModel = null;
  const loader = async (_task, model) => {
    capturedModel = model;
    return async () => ({ data: new Array(512).fill(0) });
  };
  const e = createTransformersEmbedder({
    model: 'Xenova/multilingual-e5-large',
    dimensions: 512,
    loader,
  });
  await e.embed('x');
  assert.equal(capturedModel, 'Xenova/multilingual-e5-large');
  assert.equal(e.dimensions, 512);
});

test('createTransformersEmbedder: lanza si dimension respuesta no coincide', async () => {
  const loader = async () => async () => ({ data: new Array(10).fill(0) });
  const e = createTransformersEmbedder({ dimensions: 384, loader });
  await assert.rejects(() => e.embed('x'), /dimensi\u00f3n devuelta 10 != esperada 384/);
});

test('createTransformersEmbedder: valida dimensions en constructor', () => {
  assert.throws(
    () => createTransformersEmbedder({ dimensions: 0, loader: async () => null }),
    /dimensions/,
  );
});

test('createTransformersEmbedder: sin loader ni dep instalada lanza con instrucción', async () => {
  const e = createTransformersEmbedder({ dimensions: 384 });
  await assert.rejects(() => e.embed('x'), /@xenova\/transformers/);
});

test('LanceDBStore: constructor valida dimensions', () => {
  assert.throws(
    () => new LanceDBStore({ dimensions: 0 }),
    /dimensions/,
  );
});

test('LanceDBStore: upsertOne con mock lancedb delega en table.delete + add', async () => {
  const ops = [];
  const fakeTable = {
    async delete(where) {
      ops.push({ op: 'delete', where });
    },
    async add(rows) {
      ops.push({ op: 'add', rows });
    },
    async countRows() {
      return ops.filter((o) => o.op === 'add').length;
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
  const store = new LanceDBStore({ dimensions: 4, lancedb: fakeLancedb });
  await store.upsertOne({ id: 'a', vector: [1, 0, 0, 0], metadata: { content: 'hola' } });
  assert.equal(ops[0].op, 'delete');
  assert.equal(ops[1].op, 'add');
  assert.equal(ops[1].rows[0].id, 'a');
});

test('LanceDBStore: upsert añade document_id y deleteByDocument borra por él', async () => {
  const ops = [];
  let rows = 5;
  const fakeTable = {
    async delete(where) {
      ops.push({ op: 'delete', where });
      if (where.includes('document_id')) rows -= 2;
    },
    async add(added) {
      ops.push({ op: 'add', rows: added });
    },
    async countRows() {
      return rows;
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
  const store = new LanceDBStore({ dimensions: 4, lancedb: fakeLancedb });
  await store.upsertOne({
    id: 'doc:faq.md#0',
    vector: [1, 0, 0, 0],
    metadata: { content: 'hola', documentId: 'doc:faq.md' },
  });
  const added = ops.find((o) => o.op === 'add');
  assert.equal(added.rows[0].document_id, 'doc:faq.md');

  const removed = await store.deleteByDocument('doc:faq.md');
  assert.equal(removed, 2);
  assert.ok(ops.some((o) => o.op === 'delete' && o.where === "document_id = 'doc:faq.md'"));
  await assert.rejects(() => store.deleteByDocument(''), /documentId/);
});

test('LanceDBStore: deleteByDocument sin columna document_id da error accionable', async () => {
  const fakeTable = {
    async delete(where) {
      if (where.includes('document_id')) throw new Error('no such column: document_id');
    },
    async countRows() {
      return 1;
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
  const store = new LanceDBStore({ dimensions: 4, lancedb: fakeLancedb });
  await assert.rejects(() => store.deleteByDocument('doc:x'), /Reindexa/);
});

test('LanceDBStore: search con mock devuelve hits ordenados con score=1-distance', async () => {
  const fakeTable = {
    async delete() {},
    async add() {},
    async countRows() {
      return 2;
    },
    search(_v) {
      const chain = {
        _limit: 0,
        limit(n) {
          this._limit = n;
          return this;
        },
        async toArray() {
          return [
            { id: 'a', vector: [1, 0], metadata: '{"x":1}', _distance: 0.1 },
            { id: 'b', vector: [0, 1], metadata: '{"x":2}', _distance: 0.4 },
          ];
        },
      };
      return chain;
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
  const hits = await store.search([1, 0], { topK: 2 });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].id, 'a');
  assert.ok(Math.abs(hits[0].score - 0.9) < 1e-6);
});

test('LanceDBStore: sin dep real lanza con instrucción', async () => {
  const store = new LanceDBStore({ dimensions: 4 });
  await assert.rejects(() => store.upsertOne({ id: 'x', vector: [1, 0, 0, 0] }), /@lancedb\/lancedb/);
});
