// @ts-check
/**
 * KJR-BUG-0006 (parte 1): la sensibilidad se declara en la config easy,
 * se estampa en la metadata de cada chunk al indexar y viaja hasta los
 * hits de query — la base para el routing por nivel de la parte 2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { maxSensitivity, DEFAULT_SENSITIVITY } from '../src/domain/document.js';
import { validateEasyConfig, DEFAULT_EASY_CONFIG } from '../src/easy/config.js';
import {
  resolveDocumentSensitivity,
  effectiveSensitivityOfHits,
} from '../src/easy/sensitivity.js';
import { indexDirectory } from '../src/easy/indexer.js';
import { queryIndex } from '../src/easy/query.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';

test('maxSensitivity devuelve el nivel más restrictivo', () => {
  assert.equal(maxSensitivity(['public', 'internal']), 'internal');
  assert.equal(maxSensitivity(['internal', 'confidential', 'public']), 'confidential');
  assert.equal(maxSensitivity(['public']), 'public');
  assert.equal(maxSensitivity([]), DEFAULT_SENSITIVITY);
});

test('maxSensitivity ignora valores desconocidos y aplica el default seguro', () => {
  assert.equal(maxSensitivity(/** @type {never} */ (['bogus'])), DEFAULT_SENSITIVITY);
  assert.equal(maxSensitivity(/** @type {never} */ (['public', 'bogus'])), DEFAULT_SENSITIVITY);
});

test('validateEasyConfig acepta sensitivity y sensitivityRules válidos', () => {
  const config = validateEasyConfig({
    sensitivity: 'confidential',
    sensitivityRules: [{ prefix: 'docs/public/', level: 'public' }],
  });
  assert.equal(config.sensitivity, 'confidential');
  assert.equal(config.sensitivityRules?.[0].level, 'public');
});

test('validateEasyConfig rechaza niveles y reglas inválidos', () => {
  assert.throws(() => validateEasyConfig({ sensitivity: 'secret' }), /sensitivity/);
  assert.throws(() => validateEasyConfig({ sensitivityRules: 'docs/' }), /sensitivityRules/);
  assert.throws(
    () => validateEasyConfig({ sensitivityRules: [{ prefix: 'docs/', level: 'top' }] }),
    /sensitivityRules/,
  );
  assert.throws(
    () => validateEasyConfig({ sensitivityRules: [{ level: 'public' }] }),
    /sensitivityRules/,
  );
});

test('DEFAULT_EASY_CONFIG declara el default seguro (internal)', () => {
  assert.equal(DEFAULT_EASY_CONFIG.sensitivity, DEFAULT_SENSITIVITY);
});

test('resolveDocumentSensitivity: regla por prefijo > nivel global > default', () => {
  const config = {
    sensitivity: /** @type {const} */ ('internal'),
    sensitivityRules: [
      { prefix: 'docs/public/', level: /** @type {const} */ ('public') },
      { prefix: 'finanzas/', level: /** @type {const} */ ('confidential') },
    ],
  };
  assert.equal(resolveDocumentSensitivity('docs/public/faq.md', config), 'public');
  assert.equal(resolveDocumentSensitivity('finanzas/2026.csv', config), 'confidential');
  assert.equal(resolveDocumentSensitivity('src/index.js', config), 'internal');
  assert.equal(resolveDocumentSensitivity('src/index.js', {}), DEFAULT_SENSITIVITY);
  assert.equal(resolveDocumentSensitivity('src/index.js', null), DEFAULT_SENSITIVITY);
});

test('resolveDocumentSensitivity: los prefijos respetan fronteras de ruta (KJR-BUG-0008)', () => {
  const config = {
    sensitivity: /** @type {const} */ ('confidential'),
    sensitivityRules: [{ prefix: 'docs/public', level: /** @type {const} */ ('public') }],
  };
  // "docs/public" cubre el directorio y sus hijos…
  assert.equal(resolveDocumentSensitivity('docs/public/faq.md', config), 'public');
  // …pero NUNCA a un hermano cuyo nombre solo comparte prefijo de string.
  assert.equal(resolveDocumentSensitivity('docs/public-secrets/nominas.md', config), 'confidential');
  assert.equal(resolveDocumentSensitivity('docs/publico.md', config), 'confidential');
  // Un prefijo que apunta a un fichero exacto también matchea.
  assert.equal(resolveDocumentSensitivity('docs/public', config), 'public');
  // Prefijo con barra final: comportamiento idéntico.
  const conBarra = {
    sensitivityRules: [{ prefix: 'docs/public/', level: /** @type {const} */ ('public') }],
  };
  assert.equal(resolveDocumentSensitivity('docs/public/faq.md', conBarra), 'public');
  assert.equal(resolveDocumentSensitivity('docs/public-secrets/x.md', conBarra), 'internal');
});

test('resolveDocumentSensitivity: gana la primera regla que matchea', () => {
  const config = {
    sensitivityRules: [
      { prefix: 'docs/', level: /** @type {const} */ ('confidential') },
      { prefix: 'docs/public/', level: /** @type {const} */ ('public') },
    ],
  };
  assert.equal(resolveDocumentSensitivity('docs/public/faq.md', config), 'confidential');
});

test('effectiveSensitivityOfHits: máximo de los hits, default para los sin marca', () => {
  assert.equal(
    effectiveSensitivityOfHits([{ sensitivity: 'public' }, { sensitivity: 'confidential' }]),
    'confidential',
  );
  assert.equal(effectiveSensitivityOfHits([{ sensitivity: 'public' }]), 'public');
  // Hit sin marca (índice pre-0.7.0) → default seguro.
  assert.equal(
    effectiveSensitivityOfHits([{ sensitivity: 'public' }, {}]),
    DEFAULT_SENSITIVITY,
  );
  assert.equal(effectiveSensitivityOfHits([]), DEFAULT_SENSITIVITY);
});

test('indexDirectory estampa la sensibilidad en la metadata de cada chunk', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-sensmeta-'));
  try {
    await mkdir(path.join(root, 'privado'), { recursive: true });
    await writeFile(path.join(root, 'README.md'), '# Público\nDocumentación general.\n', 'utf8');
    await writeFile(path.join(root, 'privado', 'notas.md'), '# Notas\nSolo internas.\n', 'utf8');

    const store = new InMemoryVectorStore({ dimensions: 32 });
    const embedder = createHashEmbedder({ dimensions: 32 });
    await indexDirectory(root, {
      store,
      embedder,
      sensitivityFor: (relPath) => (relPath.startsWith('privado/') ? 'confidential' : 'public'),
    });

    const [vector] = await embedder.embedBatch(['notas internas']);
    const hits = /** @type {{ metadata?: Record<string, unknown> }[]} */ (
      await store.search(vector, { topK: 10 })
    );
    assert.ok(hits.length >= 2, 'hay chunks de ambos ficheros');
    for (const hit of hits) {
      const source = String(hit.metadata?.source ?? '');
      const expected = source.startsWith('privado/') ? 'confidential' : 'public';
      assert.equal(hit.metadata?.sensitivity, expected, `sensibilidad de ${source}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('indexDirectory sin sensitivityFor estampa el default seguro', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-sensdef-'));
  try {
    await writeFile(path.join(root, 'README.md'), '# Docs\nContenido.\n', 'utf8');
    const store = new InMemoryVectorStore({ dimensions: 32 });
    const embedder = createHashEmbedder({ dimensions: 32 });
    await indexDirectory(root, { store, embedder });

    const [vector] = await embedder.embedBatch(['contenido']);
    const hits = /** @type {{ metadata?: Record<string, unknown> }[]} */ (
      await store.search(vector, { topK: 5 })
    );
    assert.ok(hits.length > 0);
    for (const hit of hits) {
      assert.equal(hit.metadata?.sensitivity, DEFAULT_SENSITIVITY);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('queryIndex expone la sensibilidad de cada hit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-sensquery-'));
  try {
    await writeFile(path.join(root, 'guia.md'), '# Guía\nCómo desplegar el servicio.\n', 'utf8');
    const store = new InMemoryVectorStore({ dimensions: 32 });
    const embedder = createHashEmbedder({ dimensions: 32 });
    await indexDirectory(root, {
      store,
      embedder,
      sensitivityFor: () => 'confidential',
    });

    const result = await queryIndex('cómo desplegar', {
      rootDir: root,
      store: /** @type {never} */ (store),
      embedder,
      topK: 3,
    });
    assert.ok(result.hits.length > 0);
    for (const hit of result.hits) {
      assert.equal(hit.sensitivity, 'confidential');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
