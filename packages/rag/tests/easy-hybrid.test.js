// @ts-check
/**
 * KJR-TSK-0145 (épica CAG) — modo hybrid: el retrieval SELECCIONA los
 * ficheros relevantes y el contexto lleva esos ficheros COMPLETOS en
 * orden determinista. Los excluidos por presupuesto se declaran
 * explícitamente — selección visible, nunca truncado silencioso.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildHybridContext } from '../src/easy/cag.js';
import { indexDirectory } from '../src/easy/indexer.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';

/** @param {string} root */
async function indexCorpus(root, sensitivityFor = undefined) {
  const store = new InMemoryVectorStore({ dimensions: 32 });
  const embedder = createHashEmbedder({ dimensions: 32 });
  await indexDirectory(root, {
    store,
    embedder,
    ...(sensitivityFor ? { sensitivityFor } : {}),
  });
}

/** Hits de retrieval simulados (lo que devolvería queryIndex). */
const hit = (source, score, sensitivity = 'internal') => ({
  id: `${source}#0`, content: 'fragmento', source, line: 1, score,
  scores: { vector: score, bm25: score }, sensitivity,
});

test('buildHybridContext: ficheros completos de los hits, orden determinista por ruta', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-hyb-'));
  try {
    await writeFile(path.join(root, 'billing.md'), '# Billing\nTarifa base más impuestos, con descuentos anuales.\n', 'utf8');
    await writeFile(path.join(root, 'deploy.md'), '# Deploy\nterraform apply contra cloud run.\n', 'utf8');
    await writeFile(path.join(root, 'ajeno.md'), '# Ajeno\nNo relevante.\n', 'utf8');
    await indexCorpus(root);

    // Dos chunks del mismo fichero + otro fichero: dedupe a nivel fichero.
    const ctx = await buildHybridContext(root, {
      hits: [hit('deploy.md', 0.9), hit('billing.md', 0.7), hit('deploy.md', 0.6)],
    });

    assert.deepEqual(ctx.files, ['billing.md', 'deploy.md'], 'orden por ruta, no por score');
    assert.equal(ctx.hits.length, 2);
    assert.ok(ctx.hits[1].content.includes('terraform apply'), 'fichero COMPLETO, no el fragmento');
    assert.deepEqual(ctx.excluded, []);
    assert.ok(!ctx.files.includes('ajeno.md'), 'lo no recuperado no entra');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildHybridContext: presupuesto — incluye por score, excluye EXPLÍCITO', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-hyb-budget-'));
  try {
    await writeFile(path.join(root, 'peque.md'), '# P\ncorto\n', 'utf8');
    await writeFile(path.join(root, 'gigante.md'), `# G\n${'relleno '.repeat(100)}\n`, 'utf8');
    await indexCorpus(root);

    // El gigante tiene MEJOR score pero no cabe; el pequeño sí.
    const ctx = await buildHybridContext(root, {
      hits: [hit('gigante.md', 0.9), hit('peque.md', 0.5)],
      maxChars: 100,
    });
    assert.deepEqual(ctx.files, ['peque.md']);
    assert.equal(ctx.excluded.length, 1);
    assert.equal(ctx.excluded[0].source, 'gigante.md');
    assert.ok(ctx.excluded[0].chars > 100, 'el excluido declara su tamaño');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildHybridContext: sensibilidad = máximo de los SELECCIONADOS según manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-hyb-sens-'));
  try {
    await writeFile(path.join(root, 'abierto.md'), '# Abierto\npublico\n', 'utf8');
    await writeFile(path.join(root, 'secreto.md'), '# Secreto\nreservado\n', 'utf8');
    await indexCorpus(root, (relPath) =>
      relPath === 'secreto.md' ? 'confidential' : 'public');

    const soloAbierto = await buildHybridContext(root, { hits: [hit('abierto.md', 0.9)] });
    assert.equal(soloAbierto.sensitivity, 'public', 'sin el secreto, el nivel no sube');

    const ambos = await buildHybridContext(root, {
      hits: [hit('abierto.md', 0.9), hit('secreto.md', 0.4)],
    });
    assert.equal(ambos.sensitivity, 'confidential');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildHybridContext: sin hits → error accionable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-hyb-empty-'));
  try {
    await writeFile(path.join(root, 'doc.md'), '# Doc\nalgo\n', 'utf8');
    await indexCorpus(root);
    await assert.rejects(() => buildHybridContext(root, { hits: [] }), /hits/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parseQueryArgs acepta --mode hybrid con las mismas reglas que cag', async () => {
  // La integración CLI completa del modo hybrid requiere un store real
  // (lancedb/pgvector, como el modo rag); la lógica queda cubierta por
  // los tests unitarios de buildHybridContext de arriba.
  const { parseQueryArgs } = await import('../src/easy/cli.js');
  const opts = parseQueryArgs(['q', '.', '--answer', '--mode', 'hybrid']);
  assert.equal(opts.mode, 'hybrid');
  assert.throws(() => parseQueryArgs(['q', '--mode', 'hybrid']), /--answer/);
});
