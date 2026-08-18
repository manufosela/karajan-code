// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRag } from '../src/easy/sdk.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';

async function makeCorpus() {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-sdk-'));
  await writeFile(
    path.join(root, 'faq.md'),
    '# FAQ\nLos pedidos se entregan en 48 horas laborables.\n',
    'utf8',
  );
  return root;
}

test('createRag: roundtrip index → query → status → close con deps inyectadas', async () => {
  const root = await makeCorpus();
  let closed = false;
  const store = new InMemoryVectorStore({ dimensions: 32 });
  /** @type {any} */ (store).close = async () => {
    closed = true;
  };
  try {
    const rag = await createRag({
      rootDir: root,
      store,
      embedder: createHashEmbedder({ dimensions: 32 }),
    });

    const result = await rag.index();
    assert.equal(result.indexedFiles, 1);

    const { hits } = await rag.query('pedidos 48 horas', { topK: 2 });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].source, 'faq.md');

    const status = await rag.status();
    assert.equal(status.files, 1);
    assert.equal(status.store, 'custom');

    await rag.close();
    assert.equal(closed, true, 'close delega en store.close');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createRag: defaults por nombre (in-memory + hash) y opciones topK/batchSize', async () => {
  const root = await makeCorpus();
  try {
    const rag = await createRag({
      rootDir: root,
      store: 'in-memory',
      dimensions: 16,
      topK: 1,
      batchSize: 2,
    });
    await rag.index();
    const { hits } = await rag.query('pedidos');
    assert.equal(hits.length, 1, 'usa el topK por defecto de la instancia');
    await rag.close(); // in-memory no tiene close — no debe lanzar
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createRag: status sin índice falla con instrucción clara', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-sdk-'));
  try {
    const rag = await createRag({ rootDir: root, store: 'in-memory', dimensions: 8 });
    await assert.rejects(() => rag.status(), /rag\.index\(\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createRag: pgvector por nombre sin PG_URL falla explícitamente', async () => {
  await assert.rejects(
    () => createRag({ rootDir: '.', store: 'pgvector', env: {} }),
    /PG_URL/,
  );
});
