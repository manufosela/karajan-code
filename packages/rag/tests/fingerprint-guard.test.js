// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureIndexFingerprint } from '../src/vector-store/fingerprint-guard.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { PgVectorStore } from '../src/vector-store/pgvector-store.js';
import { LanceDBStore } from '../src/vector-store/lancedb-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { indexDirectory } from '../src/easy/indexer.js';

test('ensureIndexFingerprint: registra, acepta y rechaza con error accionable', async () => {
  const store = new InMemoryVectorStore({ dimensions: 4 });
  assert.equal(await ensureIndexFingerprint(store, 'hash|4|abc'), 'registered');
  assert.equal(await ensureIndexFingerprint(store, 'hash|4|abc'), 'ok');
  await assert.rejects(
    () => ensureIndexFingerprint(store, 'transformers|384|zzz'),
    /hash\|4\|abc.*transformers\|384\|zzz.*ADR-002/s,
  );
  await assert.rejects(() => ensureIndexFingerprint(store, ''), /fingerprint/);
  await assert.rejects(
    () => ensureIndexFingerprint(/** @type {never} */ ({}), 'x'),
    /getIndexFingerprint/,
  );
});

test('PgVectorStore: fingerprint en tabla meta con upsert', async () => {
  const queries = [];
  const responses = [
    { rows: [], rowCount: 0 }, // CREATE TABLE (get)
    { rows: [], rowCount: 0 }, // SELECT → sin fingerprint
    { rows: [], rowCount: 0 }, // CREATE TABLE (set)
    { rows: [], rowCount: 1 }, // INSERT
    { rows: [], rowCount: 0 }, // CREATE TABLE (get)
    { rows: [{ value: 'hash|4|abc' }], rowCount: 1 }, // SELECT → registrado
  ];
  const client = {
    async query(text, params) {
      queries.push({ text, params });
      return responses.shift() ?? { rows: [], rowCount: 0 };
    },
  };
  const store = new PgVectorStore({ dimensions: 4, client });
  assert.equal(await store.getIndexFingerprint(), null);
  await store.setIndexFingerprint('hash|4|abc');
  assert.equal(await store.getIndexFingerprint(), 'hash|4|abc');
  assert.ok(queries.some((q) => /CREATE TABLE IF NOT EXISTS karajan_rag_chunks_meta/.test(q.text)));
  assert.ok(queries.some((q) => /ON CONFLICT \(key\) DO UPDATE/.test(q.text)));
});

test('LanceDBStore: fingerprint en fichero sidecar junto a los datos', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kjr-lance-fp-'));
  try {
    const store = new LanceDBStore({ dimensions: 4, path: dir });
    assert.equal(await store.getIndexFingerprint(), null);
    await store.setIndexFingerprint('hash|4|abc');
    assert.equal(await store.getIndexFingerprint(), 'hash|4|abc');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('indexDirectory: store con espacio incompatible falla antes de escribir', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-fp-idx-'));
  try {
    await writeFile(path.join(root, 'a.md'), '# A\nuno\n', 'utf8');
    const store16 = new InMemoryVectorStore({ dimensions: 16 });
    await indexDirectory(root, { store: store16, embedder: createHashEmbedder({ dimensions: 16 }) });
    assert.equal(store16.getIndexFingerprint()?.startsWith('hash|16|'), true);

    // Mismo store con datos, manifest borrado, embedder de otra dimensión:
    // la guarda del store corta antes de mezclar espacios.
    await rm(path.join(root, '.karajan'), { recursive: true, force: true });
    await assert.rejects(
      () =>
        indexDirectory(root, { store: store16, embedder: createHashEmbedder({ dimensions: 32 }) }),
      /ADR-002/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
