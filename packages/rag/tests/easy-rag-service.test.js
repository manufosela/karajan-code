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
import { createRagService, openEasyIndex, parseFingerprint } from '../src/easy/rag-service.js';

async function makeService() {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-service-'));
  await writeFile(
    path.join(root, 'facturas.md'),
    '# Facturación\nLa facturación mensual se emite el día 1.\n',
    'utf8',
  );
  await writeFile(path.join(root, 'otros.md'), '# Otros\nContenido sin relación.\n', 'utf8');
  const embedder = createHashEmbedder({ dimensions: 32 });
  const store = new InMemoryVectorStore({ dimensions: 32 });
  await indexDirectory(root, { store, embedder });
  const manifest = await loadManifest(root);
  assert.ok(manifest);
  const service = createRagService({ rootDir: root, manifest, embedder, store, storeName: 'in-memory' });
  return { root, service };
}

test('RagService.query: devuelve hits del índice', async () => {
  const { root, service } = await makeService();
  try {
    const result = await service.query('facturación mensual', 3);
    assert.ok(result.hits.length >= 1);
    assert.equal(result.hits[0].source, 'facturas.md');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('RagService.status: fingerprint y contadores del manifest', async () => {
  const { root, service } = await makeService();
  try {
    const status = await service.status();
    assert.equal(status.files, 2);
    assert.ok(status.chunks >= 2);
    assert.equal(status.store, 'in-memory');
    assert.deepEqual(parseFingerprint(status.fingerprint), { embedder: 'hash', dimensions: 32 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('openEasyIndex: sin índice falla con instrucción de creación', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-service-'));
  try {
    await assert.rejects(() => openEasyIndex(root, { env: {} }), /karajan-rag index/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
