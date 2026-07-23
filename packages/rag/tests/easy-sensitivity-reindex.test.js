// @ts-check
/**
 * KJR-BUG-0007 (hallazgo CRÍTICO de la revisión independiente): cambiar
 * la sensibilidad en la config y reindexar debe reestampar los ficheros
 * aunque su contenido no haya cambiado — el gate nunca puede quedarse
 * con una marca antigua menos restrictiva.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { indexDirectory } from '../src/easy/indexer.js';
import { loadManifest } from '../src/easy/manifest.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';

/** @param {string} root @param {InMemoryVectorStore} store */
async function sensibilidadesEnStore(root, store) {
  const embedder = createHashEmbedder({ dimensions: 32 });
  const [vector] = await embedder.embedBatch(['contenido']);
  const hits = /** @type {{ metadata?: Record<string, unknown> }[]} */ (
    await store.search(vector, { topK: 20 })
  );
  return new Set(hits.map((h) => String(h.metadata?.sensitivity)));
}

test('reindex reestampa la sensibilidad de ficheros sin cambios de contenido', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-restamp-'));
  try {
    await writeFile(path.join(root, 'doc.md'), '# Doc\nContenido estable.\n', 'utf8');
    const store = new InMemoryVectorStore({ dimensions: 32 });
    const embedder = createHashEmbedder({ dimensions: 32 });

    const first = await indexDirectory(root, {
      store,
      embedder,
      sensitivityFor: () => 'public',
    });
    assert.equal(first.indexedFiles, 1);
    assert.deepEqual(await sensibilidadesEnStore(root, store), new Set(['public']));

    // El corpus se endurece: mismo contenido, nivel nuevo.
    const second = await indexDirectory(root, {
      store,
      embedder,
      sensitivityFor: () => 'confidential',
    });
    assert.equal(second.indexedFiles, 1, 'el fichero sin cambios se reprocesa por nivel nuevo');
    assert.equal(second.unchangedFiles, 0);
    assert.deepEqual(await sensibilidadesEnStore(root, store), new Set(['confidential']));

    // El manifest persiste el nivel para poder detectar el próximo cambio.
    const manifest = await loadManifest(root);
    assert.equal(manifest?.files['doc.md'].sensitivity, 'confidential');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reindex con el mismo nivel no reprocesa nada', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-restamp-noop-'));
  try {
    await writeFile(path.join(root, 'doc.md'), '# Doc\nContenido estable.\n', 'utf8');
    const store = new InMemoryVectorStore({ dimensions: 32 });
    const embedder = createHashEmbedder({ dimensions: 32 });
    let embedCalls = 0;
    const countingEmbedder = {
      ...embedder,
      dimensions: embedder.dimensions,
      embedBatch: (/** @type {string[]} */ texts) => {
        embedCalls += 1;
        return embedder.embedBatch(texts);
      },
    };

    await indexDirectory(root, { store, embedder: countingEmbedder, sensitivityFor: () => 'internal' });
    const callsAfterFirst = embedCalls;
    const second = await indexDirectory(root, {
      store,
      embedder: countingEmbedder,
      sensitivityFor: () => 'internal',
    });
    assert.equal(second.indexedFiles, 0);
    assert.equal(second.unchangedFiles, 1);
    assert.equal(embedCalls, callsAfterFirst, 'sin cambios no se vuelve a embeber');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('query: metadata del store degradada a public no vence al manifest (fail-closed)', async () => {
  const { queryIndex } = await import('../src/easy/query.js');
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-floor-'));
  try {
    await writeFile(path.join(root, 'doc.md'), '# Doc\nContenido reservado.\n', 'utf8');
    const store = new InMemoryVectorStore({ dimensions: 32 });
    const embedder = createHashEmbedder({ dimensions: 32 });
    await indexDirectory(root, { store, embedder, sensitivityFor: () => 'confidential' });

    // Simula un store corrupto/manipulado que rebaja la marca a public.
    const tampered = {
      search: async (/** @type {number[]} */ vector, /** @type {object} */ opts) => {
        const hits = /** @type {{ metadata?: Record<string, unknown> }[]} */ (
          await store.search(vector, /** @type {never} */ (opts))
        );
        return hits.map((h) => ({ ...h, metadata: { ...h.metadata, sensitivity: 'public' } }));
      },
    };

    const result = await queryIndex('contenido reservado', {
      rootDir: root,
      store: /** @type {never} */ (tampered),
      embedder,
      topK: 3,
    });
    assert.ok(result.hits.length > 0);
    for (const hit of result.hits) {
      assert.equal(hit.sensitivity, 'confidential', 'gana el nivel del manifest, no el del store');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('query: hit con source desconocido para el manifest cae al default seguro', async () => {
  const { queryIndex } = await import('../src/easy/query.js');
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-floor-unknown-'));
  try {
    await writeFile(path.join(root, 'doc.md'), '# Doc\nContenido.\n', 'utf8');
    const store = new InMemoryVectorStore({ dimensions: 32 });
    const embedder = createHashEmbedder({ dimensions: 32 });
    await indexDirectory(root, { store, embedder, sensitivityFor: () => 'public' });

    const alien = {
      search: async () => [
        {
          id: 'alien#0',
          score: 1,
          metadata: { content: 'chunk inyectado', source: 'no-esta-en-el-manifest.md', sensitivity: 'public' },
        },
      ],
    };
    const result = await queryIndex('chunk inyectado', {
      rootDir: root,
      store: /** @type {never} */ (alien),
      embedder,
      topK: 1,
    });
    assert.equal(result.hits[0].sensitivity, 'internal', 'fuente desconocida nunca cuenta como public');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('manifest pre-fix (sin sensitivity) fuerza el reestampado una vez', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-restamp-legacy-'));
  try {
    await writeFile(path.join(root, 'doc.md'), '# Doc\nContenido estable.\n', 'utf8');
    const store = new InMemoryVectorStore({ dimensions: 32 });
    const embedder = createHashEmbedder({ dimensions: 32 });
    await indexDirectory(root, { store, embedder, sensitivityFor: () => 'internal' });

    // Simula un manifest de una versión anterior: entrada sin sensitivity.
    const manifestPath = path.join(root, '.karajan', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    delete manifest.files['doc.md'].sensitivity;
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

    const result = await indexDirectory(root, {
      store,
      embedder,
      sensitivityFor: () => 'internal',
    });
    assert.equal(result.indexedFiles, 1, 'entrada legacy sin nivel se reestampa');
    const restamped = await loadManifest(root);
    assert.equal(restamped?.files['doc.md'].sensitivity, 'internal');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
