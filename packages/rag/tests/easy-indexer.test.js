// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { loadManifest } from '../src/easy/manifest.js';
import { collectIndexableFiles, indexDirectory } from '../src/easy/indexer.js';

/** @returns {{ store: InMemoryVectorStore, embedder: ReturnType<typeof createHashEmbedder> }} */
function makeDeps() {
  const embedder = createHashEmbedder({ dimensions: 16 });
  const store = new InMemoryVectorStore({ dimensions: 16 });
  return { store, embedder };
}

/**
 * @param {Record<string, string>} files
 * @returns {Promise<string>} root del proyecto temporal
 */
async function makeProject(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-indexer-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  return root;
}

test('collectIndexableFiles: agrupa por preset y salta directorios excluidos', async () => {
  const root = await makeProject({
    'src/app.js': 'const a = 1;\n',
    'README.md': '# Hola\n',
    'data/ventas.csv': 'a,b\n1,2\n',
    'node_modules/x/index.js': 'ignorado\n',
    '.git/config': 'ignorado\n',
    '.karajan/manifest.json': '{}\n',
    'logo.png': 'binario\n',
  });
  try {
    const { groups, relPaths } = await collectIndexableFiles(root);
    assert.deepEqual(groups.code, ['src/app.js']);
    assert.deepEqual(groups.docs, ['README.md']);
    assert.deepEqual(groups.data, ['data/ventas.csv']);
    assert.deepEqual(groups.excluded, [{ path: 'logo.png', reason: 'binary' }]);
    assert.ok(!relPaths.some((p) => p.includes('node_modules')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('indexDirectory: primera pasada indexa todo y persiste manifest', async () => {
  const root = await makeProject({
    'src/app.js': 'export function hola() { return 1; }\n',
    'README.md': '# Título\nTexto.\n',
    'data/ventas.csv': 'a,b\n1,uno\n2,dos\n',
  });
  const { store, embedder } = makeDeps();
  try {
    const result = await indexDirectory(root, { store, embedder });
    assert.equal(result.indexedFiles, 3);
    assert.equal(result.removedFiles, 0);
    assert.ok(result.chunksUpserted >= 3);
    assert.ok(store.size() >= 3);

    const manifest = await loadManifest(root);
    assert.ok(manifest);
    assert.equal(Object.keys(manifest.files).length, 3);
    assert.equal(manifest.files['README.md'].sourceType, 'docs');
    assert.ok(manifest.files['README.md'].chunkIds.length >= 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('indexDirectory: incremental — solo reprocesa cambiados e invalida borrados', async () => {
  const root = await makeProject({
    'a.md': '# A\nuno\n',
    'b.md': '# B\ndos\n',
  });
  const { store, embedder } = makeDeps();
  try {
    await indexDirectory(root, { store, embedder });
    const before = store.size();

    await writeFile(path.join(root, 'a.md'), '# A\nuno modificado\n', 'utf8');
    await rm(path.join(root, 'b.md'));

    const result = await indexDirectory(root, { store, embedder });
    assert.equal(result.indexedFiles, 1, 'solo a.md se reprocesa');
    assert.equal(result.removedFiles, 1, 'b.md invalidado');
    assert.equal(result.unchangedFiles, 0);

    const manifest = await loadManifest(root);
    assert.ok(manifest);
    assert.deepEqual(Object.keys(manifest.files), ['a.md']);
    assert.ok(store.size() < before, 'los chunks de b.md ya no están');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('indexDirectory: sin cambios no toca el store', async () => {
  const root = await makeProject({ 'a.md': '# A\nuno\n' });
  const { store, embedder } = makeDeps();
  try {
    await indexDirectory(root, { store, embedder });
    const result = await indexDirectory(root, { store, embedder });
    assert.equal(result.indexedFiles, 0);
    assert.equal(result.unchangedFiles, 1);
    assert.equal(result.chunksUpserted, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('indexDirectory: fingerprint distinto fuerza reindex completo', async () => {
  const root = await makeProject({ 'a.md': '# A\nuno\n' });
  try {
    const first = makeDeps();
    await indexDirectory(root, { store: first.store, embedder: first.embedder });

    const otherEmbedder = createHashEmbedder({ dimensions: 32 });
    const otherStore = new InMemoryVectorStore({ dimensions: 32 });
    const result = await indexDirectory(root, { store: otherStore, embedder: otherEmbedder });
    assert.equal(result.fullReindex, true);
    assert.equal(result.indexedFiles, 1);

    const manifest = await loadManifest(root);
    assert.ok(manifest?.fingerprint.includes('|32|'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('indexDirectory: falla con ruta que no es directorio', async () => {
  const { store, embedder } = makeDeps();
  await assert.rejects(
    () => indexDirectory('/ruta/que/no/existe-kjr', { store, embedder }),
    /directorio/i,
  );
});
