// @ts-check
// KJR-TSK-0153 — easy.exclude (globs): lo que casa nunca se chunkea ni entra al manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { validateEasyConfig } from '../src/easy/config.js';
import { loadManifest } from '../src/easy/manifest.js';
import { indexDirectory } from '../src/easy/indexer.js';

const makeDeps = () => ({
  store: new InMemoryVectorStore({ dimensions: 16 }),
  embedder: createHashEmbedder({ dimensions: 16 }),
});

/** @param {Record<string, string>} files */
async function makeProject(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-exclude-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  return root;
}

const PROJECT_FILES = {
  'src/app.js': 'export const a = 1;\n',
  'certs/server.pem': '-----BEGIN FAKE KEY-----\nno-soy-una-clave\n',
  'secrets/token.json': '{ "token": "fake" }\n',
};

test('validateEasyConfig: acepta exclude como array de globs', () => {
  const config = validateEasyConfig({ exclude: ['**/*.pem', 'secrets/**'] });
  assert.deepEqual(config.exclude, ['**/*.pem', 'secrets/**']);
});

test('validateEasyConfig: rechaza exclude que no es array', () => {
  assert.throws(() => validateEasyConfig({ exclude: '**/*.pem' }), /easy\.exclude/);
});

test('validateEasyConfig: rechaza items no-string o vacíos con el path exacto', () => {
  assert.throws(() => validateEasyConfig({ exclude: ['ok', 42] }), /easy\.exclude\[1\]/);
  assert.throws(() => validateEasyConfig({ exclude: [''] }), /easy\.exclude\[0\]/);
});

test('indexDirectory: exclude deja los globs fuera del índice y del manifest', async () => {
  const root = await makeProject(PROJECT_FILES);
  const { store, embedder } = makeDeps();
  try {
    const result = await indexDirectory(root, {
      store,
      embedder,
      exclude: ['**/*.pem', 'secrets/**'],
    });
    assert.equal(result.indexedFiles, 1);
    assert.deepEqual(
      result.excluded.filter((e) => e.reason === 'config').map((e) => e.path).sort(),
      ['certs/server.pem', 'secrets/token.json'],
    );
    const manifest = await loadManifest(root);
    assert.ok(manifest);
    assert.deepEqual(Object.keys(manifest.files), ['src/app.js']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('indexDirectory: sin exclude el comportamiento no cambia', async () => {
  const root = await makeProject(PROJECT_FILES);
  const { store, embedder } = makeDeps();
  try {
    const result = await indexDirectory(root, { store, embedder });
    // Sin exclude: token.json SÍ entra al corpus; el .pem cae por preset ('unknown').
    assert.equal(result.indexedFiles, 2);
    assert.deepEqual(result.excluded, [{ path: 'certs/server.pem', reason: 'unknown' }]);
    const manifest = await loadManifest(root);
    assert.ok(manifest?.files['secrets/token.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('indexDirectory: exclude inválido falla alto, nunca indexa en silencio', async () => {
  const root = await makeProject(PROJECT_FILES);
  const { store, embedder } = makeDeps();
  try {
    await assert.rejects(
      indexDirectory(root, { store, embedder, exclude: /** @type {never} */ (['ok', 3]) }),
      /exclude/,
    );
    assert.equal(await loadManifest(root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
