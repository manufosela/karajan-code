// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { indexDirectory } from '../src/easy/indexer.js';
import { loadManifest } from '../src/easy/manifest.js';
import { createRagService } from '../src/easy/rag-service.js';
import { startRagHttpServer } from '../src/easy/http-server.js';

/** Servidor sobre un índice temporal en puerto efímero. */
async function makeServer() {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-http-'));
  await writeFile(path.join(root, 'faq.md'), '# FAQ\nLos pedidos llegan en 48 horas.\n', 'utf8');
  const embedder = createHashEmbedder({ dimensions: 32 });
  const store = new InMemoryVectorStore({ dimensions: 32 });
  await indexDirectory(root, { store, embedder });
  const manifest = await loadManifest(root);
  assert.ok(manifest);
  const service = createRagService({ rootDir: root, manifest, embedder, store, storeName: 'in-memory' });
  const { server, url } = await startRagHttpServer(service, { port: 0, host: '127.0.0.1' });
  return {
    url,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('GET /health: ok con estado del índice', async () => {
  const { url, close } = await makeServer();
  try {
    const res = await fetch(`${url}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.files, 1);
    assert.equal(body.store, 'in-memory');
  } finally {
    await close();
  }
});

test('POST /query: devuelve hits', async () => {
  const { url, close } = await makeServer();
  try {
    const res = await fetch(`${url}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'pedidos 48 horas', topK: 2 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.hits.length >= 1);
    assert.equal(body.hits[0].source, 'faq.md');
  } finally {
    await close();
  }
});

test('POST /query: validación estricta de entrada', async () => {
  const { url, close } = await makeServer();
  try {
    const empty = await fetch(`${url}/query`, { method: 'POST', body: '{}' });
    assert.equal(empty.status, 400);
    assert.match((await empty.json()).error, /question/);

    const badJson = await fetch(`${url}/query`, { method: 'POST', body: '{rotisimo' });
    assert.equal(badJson.status, 400);

    const badTopK = await fetch(`${url}/query`, {
      method: 'POST',
      body: JSON.stringify({ question: 'q', topK: 0 }),
    });
    assert.equal(badTopK.status, 400);
    assert.match((await badTopK.json()).error, /topK/);
  } finally {
    await close();
  }
});

test('rutas desconocidas → 404 JSON', async () => {
  const { url, close } = await makeServer();
  try {
    const res = await fetch(`${url}/otra`);
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /no soportada/);
  } finally {
    await close();
  }
});
