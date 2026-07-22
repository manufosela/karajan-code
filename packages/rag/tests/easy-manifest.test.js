// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  computeIndexFingerprint,
  hashContent,
  createEmptyManifest,
  diffManifest,
  loadManifest,
  saveManifest,
  MANIFEST_DIR,
  MANIFEST_FILE,
} from '../src/easy/manifest.js';

test('computeIndexFingerprint: determinista y sensible a cada componente (ADR-002)', () => {
  const base = computeIndexFingerprint({ embedderName: 'hash', dimensions: 64 });
  assert.equal(base, computeIndexFingerprint({ embedderName: 'hash', dimensions: 64 }));
  assert.notEqual(base, computeIndexFingerprint({ embedderName: 'transformers', dimensions: 64 }));
  assert.notEqual(base, computeIndexFingerprint({ embedderName: 'hash', dimensions: 128 }));
  assert.ok(base.includes('hash|64'), 'legible para debugging');
});

test('hashContent: sha256 hex estable', () => {
  assert.equal(hashContent('hola'), hashContent('hola'));
  assert.notEqual(hashContent('hola'), hashContent('hola '));
  assert.match(hashContent(''), /^[a-f0-9]{64}$/);
});

test('createEmptyManifest: forma inicial', () => {
  const m = createEmptyManifest('hash|64');
  assert.equal(m.version, 1);
  assert.equal(m.fingerprint, 'hash|64');
  assert.deepEqual(m.files, {});
});

test('diffManifest: detecta added/changed/removed/unchanged', () => {
  const manifest = createEmptyManifest('fp');
  manifest.files['a.md'] = { hash: hashContent('A'), sourceType: 'docs', chunkIds: ['a#0'] };
  manifest.files['b.md'] = { hash: hashContent('B'), sourceType: 'docs', chunkIds: ['b#0'] };
  manifest.files['c.csv'] = { hash: hashContent('C'), sourceType: 'data', chunkIds: ['c#0'] };

  const diff = diffManifest(manifest, {
    'a.md': hashContent('A'),
    'b.md': hashContent('B2'),
    'd.js': hashContent('D'),
  });
  assert.deepEqual(diff.unchanged, ['a.md']);
  assert.deepEqual(diff.changed, ['b.md']);
  assert.deepEqual(diff.added, ['d.js']);
  assert.deepEqual(diff.removed, ['c.csv']);
});

test('save/loadManifest: round-trip en .karajan/manifest.json', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kjr-manifest-'));
  try {
    const manifest = createEmptyManifest('fp|1');
    manifest.files['x.md'] = { hash: 'h', sourceType: 'docs', chunkIds: ['x#0', 'x#1'] };
    await saveManifest(dir, manifest);

    const raw = await readFile(path.join(dir, MANIFEST_DIR, MANIFEST_FILE), 'utf8');
    assert.ok(raw.endsWith('\n'), 'JSON con newline final');

    const loaded = await loadManifest(dir);
    assert.deepEqual(loaded, manifest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadManifest: null si no existe, error si está corrupto', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kjr-manifest-'));
  try {
    assert.equal(await loadManifest(dir), null);

    const bad = createEmptyManifest('fp');
    // @ts-expect-error corrupción a propósito
    bad.files = 'no-es-un-objeto';
    await saveManifest(dir, /** @type {never} */ (bad));
    await assert.rejects(() => loadManifest(dir), /manifest/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
