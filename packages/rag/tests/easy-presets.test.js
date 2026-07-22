// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSourceType,
  resolvePreset,
  classifySources,
  chunkWithPreset,
} from '../src/easy/presets.js';

test('detectSourceType: código por extensión de lenguaje', () => {
  assert.equal(detectSourceType('src/app.js'), 'code');
  assert.equal(detectSourceType('lib/mod.ts'), 'code');
  assert.equal(detectSourceType('main.py'), 'code');
  assert.equal(detectSourceType('cmd/server.go'), 'code');
  assert.equal(detectSourceType('Component.astro'), 'code');
});

test('detectSourceType: docs por extensión de texto', () => {
  assert.equal(detectSourceType('README.md'), 'docs');
  assert.equal(detectSourceType('guide.mdx'), 'docs');
  assert.equal(detectSourceType('notes.txt'), 'docs');
  assert.equal(detectSourceType('manual.rst'), 'docs');
});

test('detectSourceType: datos por extensión tabular', () => {
  assert.equal(detectSourceType('ventas.csv'), 'data');
  assert.equal(detectSourceType('export.tsv'), 'data');
  assert.equal(detectSourceType('config.json'), 'data');
  assert.equal(detectSourceType('events.jsonl'), 'data');
});

test('detectSourceType: binarios y desconocidos quedan marcados', () => {
  assert.equal(detectSourceType('logo.png'), 'binary');
  assert.equal(detectSourceType('doc.pdf'), 'binary');
  assert.equal(detectSourceType('paquete.tgz'), 'binary');
  assert.equal(detectSourceType('raro.xyz'), 'unknown');
  assert.equal(detectSourceType('Makefile'), 'unknown');
});

test('resolvePreset: devuelve preset completo por tipo (ADR-005)', () => {
  for (const type of /** @type {const} */ (['code', 'docs', 'data'])) {
    const preset = resolvePreset(type);
    assert.equal(preset.sourceType, type);
    assert.equal(typeof preset.chunker.name, 'string');
    assert.equal(typeof preset.chunker.options, 'object');
    assert.equal(preset.embedder.name, 'hash');
    assert.equal(preset.store.name, 'lancedb');
  }
  assert.equal(resolvePreset('code').chunker.name, 'separators');
  assert.equal(resolvePreset('docs').chunker.name, 'headings');
  assert.equal(resolvePreset('data').chunker.name, 'records');
});

test('resolvePreset: no incluye overrides de policy ni redaction', () => {
  for (const type of /** @type {const} */ (['code', 'docs', 'data'])) {
    const preset = resolvePreset(type);
    assert.ok(!('policy' in preset), 'un preset nunca toca la policy');
    assert.ok(!('redaction' in preset), 'un preset nunca toca la redacción');
  }
});

test('resolvePreset: los presets son inmutables y falla con tipo desconocido', () => {
  const preset = resolvePreset('docs');
  assert.ok(Object.isFrozen(preset));
  assert.ok(Object.isFrozen(preset.chunker.options));
  // @ts-expect-error tipo inválido a propósito
  assert.throws(() => resolvePreset('binary'), /sourceType/);
});

test('classifySources: carpeta mixta agrupa por preset y excluye binarios', () => {
  const groups = classifySources([
    'src/index.js',
    'src/util.ts',
    'README.md',
    'data/ventas.csv',
    'assets/logo.png',
    'Makefile',
  ]);
  assert.deepEqual(groups.code, ['src/index.js', 'src/util.ts']);
  assert.deepEqual(groups.docs, ['README.md']);
  assert.deepEqual(groups.data, ['data/ventas.csv']);
  assert.deepEqual(groups.excluded, [
    { path: 'assets/logo.png', reason: 'binary' },
    { path: 'Makefile', reason: 'unknown' },
  ]);
});

test('chunkWithPreset: aplica el chunker declarado por el preset', () => {
  const codeDoc = {
    id: 'c',
    content: 'export function a() {}\n\nexport function b() {}\n',
    metadata: {},
  };
  const codeChunks = chunkWithPreset(codeDoc, resolvePreset('code'));
  assert.ok(codeChunks.length >= 1);

  const docsDoc = { id: 'm', content: '# Uno\nA.\n\n# Dos\nB.', metadata: {} };
  const docsChunks = chunkWithPreset(docsDoc, resolvePreset('docs'));
  assert.equal(docsChunks[1].metadata.heading, 'Dos');

  const dataDoc = { id: 't', content: 'a,b\n1,uno\n2,dos', metadata: {} };
  const dataChunks = chunkWithPreset(dataDoc, resolvePreset('data'));
  assert.equal(dataChunks[0].metadata.format, 'csv');
});

test('chunkWithPreset: chunker desconocido falla explícitamente', () => {
  const doc = { id: 'd', content: 'x', metadata: {} };
  const fake = { sourceType: 'docs', chunker: { name: 'nope', options: {} } };
  // @ts-expect-error preset inválido a propósito
  assert.throws(() => chunkWithPreset(doc, fake), /chunker/);
});
