// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { indexDirectory } from '../src/easy/indexer.js';
import { queryIndex } from '../src/easy/query.js';

/**
 * Proyecto temporal indexado con in-memory + hash para las queries.
 *
 * @param {Record<string, string>} files
 */
async function makeIndexedProject(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-query-'));
  for (const [rel, content] of Object.entries(files)) {
    await writeFile(path.join(root, rel), content, 'utf8');
  }
  const embedder = createHashEmbedder({ dimensions: 32 });
  const store = new InMemoryVectorStore({ dimensions: 32 });
  await indexDirectory(root, { store, embedder });
  return { root, store, embedder };
}

test('queryIndex: devuelve pasajes con score, fuente y línea', async () => {
  const { root, store, embedder } = await makeIndexedProject({
    'guia.md': '# Instalación\nPasos de instalación.\n\n# Facturación\nLa facturación mensual se emite el día 1.\n',
    'notas.md': '# Notas\nSin relación con pagos.\n',
  });
  try {
    const result = await queryIndex('facturación mensual', { rootDir: root, store, embedder, topK: 3 });
    assert.ok(result.hits.length >= 1);
    const [top] = result.hits;
    assert.equal(top.source, 'guia.md');
    assert.equal(typeof top.score, 'number');
    assert.ok(top.line >= 4, `la sección de facturación empieza en línea 4+, fue ${top.line}`);
    assert.ok(top.content.includes('facturación'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('queryIndex: el término exacto sube por BM25 aunque el vector hash no lo favorezca', async () => {
  const { root, store, embedder } = await makeIndexedProject({
    'a.md': '# Uno\nkiwis y plátanos frescos del mercado.\n',
    'b.md': '# Dos\ntexto genérico sin la palabra clave.\n',
  });
  try {
    const result = await queryIndex('kiwis', { rootDir: root, store, embedder, topK: 2 });
    assert.equal(result.hits[0].source, 'a.md');
    assert.ok(result.hits[0].scores.bm25 > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('queryIndex: respeta topK y no duplica pasajes casi idénticos', async () => {
  const repeated = '# Sec\nfrase repetida idéntica para dedupe.\n';
  const { root, store, embedder } = await makeIndexedProject({
    'x.md': repeated,
    'y.md': repeated,
    'z.md': '# Otra\ncontenido distinto.\n',
  });
  try {
    const result = await queryIndex('frase repetida', { rootDir: root, store, embedder, topK: 5 });
    const contents = result.hits.map((h) => h.content);
    assert.equal(new Set(contents).size, contents.length, 'sin pasajes duplicados');
    const small = await queryIndex('frase repetida', { rootDir: root, store, embedder, topK: 1 });
    assert.equal(small.hits.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('queryIndex: valida entrada', async () => {
  const embedder = createHashEmbedder({ dimensions: 16 });
  const store = new InMemoryVectorStore({ dimensions: 16 });
  await assert.rejects(
    () => queryIndex('', { rootDir: '.', store, embedder }),
    /pregunta/i,
  );
});
