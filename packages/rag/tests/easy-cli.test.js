// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseIndexArgs, createEasyDeps, runIndexCommand } from '../src/easy/cli.js';

test('parseIndexArgs: defaults ADR-005 (lancedb + hash)', () => {
  const opts = parseIndexArgs(['./docs']);
  assert.equal(opts.store, 'lancedb');
  assert.equal(opts.embedder, 'hash');
  assert.equal(opts.dimensions, 256);
  assert.ok(path.isAbsolute(opts.rootDir));
});

test('parseIndexArgs: flags explícitos y dimensions por embedder', () => {
  const opts = parseIndexArgs(['.', '--store', 'in-memory', '--embedder', 'transformers']);
  assert.equal(opts.store, 'in-memory');
  assert.equal(opts.dimensions, 384);
  const custom = parseIndexArgs(['.', '--dimensions', '128']);
  assert.equal(custom.dimensions, 128);
});

test('parseIndexArgs: valida ruta, store y embedder', () => {
  assert.throws(() => parseIndexArgs([]), /ruta/);
  assert.throws(() => parseIndexArgs(['.', '--store', 'redis']), /--store/);
  assert.throws(() => parseIndexArgs(['.', '--embedder', 'openai']), /--embedder/);
  assert.throws(() => parseIndexArgs(['.', '--dimensions', 'muchas']), /--dimensions/);
});

test('createEasyDeps: pgvector sin PG_URL falla con mensaje accionable', async () => {
  const options = parseIndexArgs(['.', '--store', 'pgvector']);
  await assert.rejects(() => createEasyDeps(options, {}), /PG_URL/);
});

test('createEasyDeps: in-memory construye store y embedder coherentes', async () => {
  const options = parseIndexArgs(['.', '--store', 'in-memory', '--dimensions', '32']);
  const { embedder, store } = await createEasyDeps(options, {});
  assert.equal(embedder.dimensions, 32);
  const [vector] = await embedder.embedBatch(['hola']);
  assert.equal(vector.length, 32);
  await store.upsert([{ id: 'x', vector, metadata: {} }]);
});

test('runIndexCommand: end-to-end con in-memory sobre un proyecto temporal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cli-'));
  const logs = [];
  try {
    await writeFile(path.join(root, 'README.md'), '# Demo\nTexto.\n', 'utf8');
    const result = await runIndexCommand([root, '--store', 'in-memory'], {
      env: {},
      log: (msg) => logs.push(msg),
    });
    assert.equal(result.indexedFiles, 1);
    assert.ok(logs.some((l) => l.includes('efímero')));
    assert.ok(logs.some((l) => l.startsWith('hecho:')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
