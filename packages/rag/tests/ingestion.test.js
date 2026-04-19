// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadTextFile, loadTextDirectory } from '../src/ingestion/loaders.js';
import { chunkByFixedSize, chunkBySeparators } from '../src/ingestion/chunkers.js';

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'kjr-ingestion-'));
}

test('loadTextFile: lee un .md y devuelve Document con mimeType correcto', async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'note.md');
  writeFileSync(file, '# Título\n\nContenido.');
  try {
    const doc = await loadTextFile(file);
    assert.equal(doc.content, '# Título\n\nContenido.');
    assert.equal(doc.metadata.mimeType, 'text/markdown');
    assert.equal(doc.metadata.source, path.resolve(file));
    assert.ok(doc.id.startsWith('doc:'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTextFile: .txt se detecta como text/plain', async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'plain.txt');
  writeFileSync(file, 'hola');
  try {
    const doc = await loadTextFile(file);
    assert.equal(doc.metadata.mimeType, 'text/plain');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTextDirectory: lista todos los .md/.txt (no recursivo por defecto)', async () => {
  const dir = makeTmpDir();
  writeFileSync(path.join(dir, 'a.md'), 'a');
  writeFileSync(path.join(dir, 'b.txt'), 'b');
  writeFileSync(path.join(dir, 'c.png'), 'skipped');
  try {
    const docs = await loadTextDirectory(dir);
    assert.equal(docs.length, 2);
    const contents = docs.map((d) => d.content).sort();
    assert.deepEqual(contents, ['a', 'b']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTextDirectory: recursive true carga subdirectorios', async () => {
  const dir = makeTmpDir();
  const sub = path.join(dir, 'sub');
  writeFileSync(path.join(dir, 'a.md'), 'a');
  mkdirSync(sub);
  writeFileSync(path.join(sub, 'b.md'), 'b');
  try {
    const docs = await loadTextDirectory(dir, { recursive: true });
    assert.equal(docs.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTextDirectory: rechaza si no es un directorio', async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'x.md');
  writeFileSync(file, 'x');
  try {
    await assert.rejects(() => loadTextDirectory(file), /no es un directorio/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chunkByFixedSize: trocea 1000 chars con size 300 overlap 50', () => {
  const content = 'x'.repeat(1000);
  const doc = { id: 'd1', content, metadata: {} };
  const chunks = chunkByFixedSize(doc, { size: 300, overlap: 50 });
  assert.ok(chunks.length > 3);
  assert.equal(chunks[0].content.length, 300);
  assert.equal(chunks[0].metadata.offset, 0);
  assert.equal(chunks[1].metadata.offset, 250); // step = 300-50
  assert.equal(chunks[0].id, 'd1#0');
  assert.equal(chunks[1].documentId, 'd1');
});

test('chunkByFixedSize: valida size y overlap', () => {
  const doc = { id: 'd', content: 'abc', metadata: {} };
  assert.throws(() => chunkByFixedSize(doc, { size: 0 }), /size/);
  assert.throws(() => chunkByFixedSize(doc, { size: 10, overlap: 10 }), /overlap/);
  assert.throws(() => chunkByFixedSize(doc, { size: 10, overlap: -1 }), /overlap/);
});

test('chunkByFixedSize: documento vacío devuelve array vacío', () => {
  const doc = { id: 'd', content: '', metadata: {} };
  assert.deepEqual(chunkByFixedSize(doc, { size: 100 }), []);
});

test('chunkBySeparators: respeta saltos de párrafo cuando caben en maxSize', () => {
  const content = 'Párrafo uno.\n\nPárrafo dos.\n\nPárrafo tres corto.';
  const doc = { id: 'd', content, metadata: {} };
  const chunks = chunkBySeparators(doc, { separators: ['\n\n', '. '], maxSize: 60 });
  assert.ok(chunks.length >= 1);
  // Ningún chunk debería superar maxSize.
  for (const c of chunks) {
    assert.ok(c.content.length <= 60, `chunk len ${c.content.length}`);
  }
});

test('chunkBySeparators: recurre a separador menor si el fragmento es demasiado grande', () => {
  const big = 'A'.repeat(100) + '. ' + 'B'.repeat(100);
  const doc = { id: 'd', content: big, metadata: {} };
  const chunks = chunkBySeparators(doc, { separators: ['\n\n', '. '], maxSize: 120 });
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(c.content.length <= 120);
});

test('chunkBySeparators: asigna IDs e índices correlativos', () => {
  const doc = { id: 'docX', content: 'aaa\n\nbbb\n\nccc', metadata: {} };
  const chunks = chunkBySeparators(doc, { separators: ['\n\n'], maxSize: 5 });
  assert.equal(chunks[0].id, 'docX#0');
  assert.equal(chunks[1].id, 'docX#1');
  assert.equal(chunks[chunks.length - 1].documentId, 'docX');
});
