// @ts-check
/**
 * KJR-TSK-0146 (épica CAG) — rag.answer() en el SDK: los tres modos de
 * respuesta desde código, con las mismas garantías que el CLI (policy +
 * redactPII por el camino guardado). Integración completa gracias a la
 * inyección de store del SDK.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRag } from '../src/easy/sdk.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';

/** Registry fake: solo responde por ollama y captura los prompts. */
function fakeRegistry(prompts) {
  return {
    has: (/** @type {string} */ name) => name === 'ollama',
    get: () => async (/** @type {string} */ prompt) => {
      prompts.push(prompt);
      return { parsedOutput: { text: 'respuesta sdk' } };
    },
  };
}

/** @returns {Promise<{ root: string, rag: import('../src/easy/sdk.js').Rag }>} */
async function makeRag() {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-sdk-answer-'));
  await writeFile(path.join(root, 'billing.md'), '# Billing\nLa tarifa base incluye impuestos. Contacto: pagos@example.com\n', 'utf8');
  await writeFile(path.join(root, 'deploy.md'), '# Deploy\nSe despliega con terraform apply.\n', 'utf8');
  const rag = await createRag({
    rootDir: root,
    store: new InMemoryVectorStore({ dimensions: 32 }),
    embedder: createHashEmbedder({ dimensions: 32 }),
  });
  await rag.index();
  return { root, rag };
}

test('rag.answer mode rag: top-k chunks por el camino guardado (PII redactada)', async () => {
  const { root, rag } = await makeRag();
  try {
    /** @type {string[]} */
    const prompts = [];
    const res = await rag.answer('qué incluye la tarifa base', {
      mode: 'rag',
      registry: fakeRegistry(prompts),
    });
    assert.equal(res.answer, 'respuesta sdk');
    assert.equal(res.mode, 'rag');
    assert.equal(res.adapter, 'ollama', 'default claude no permitido para internal → ollama');
    assert.equal(prompts.length, 1);
    assert.ok(!prompts[0].includes('pagos@example.com'), 'PII redactada');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rag.answer mode cag: corpus completo, files y sensibilidad global', async () => {
  const { root, rag } = await makeRag();
  try {
    /** @type {string[]} */
    const prompts = [];
    const res = await rag.answer('resume el corpus', {
      mode: 'cag',
      registry: fakeRegistry(prompts),
    });
    assert.equal(res.mode, 'cag');
    assert.deepEqual(res.files, ['billing.md', 'deploy.md']);
    assert.equal(res.sensitivity, 'internal');
    assert.ok(prompts[0].includes('terraform apply'), 'todo el corpus viaja');
    assert.ok(prompts[0].includes('tarifa base'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rag.answer mode hybrid: ficheros completos seleccionados y excluded declarado', async () => {
  const { root, rag } = await makeRag();
  try {
    /** @type {string[]} */
    const prompts = [];
    const res = await rag.answer('cómo se despliega el servicio con terraform', {
      mode: 'hybrid',
      registry: fakeRegistry(prompts),
      topK: 2,
    });
    assert.equal(res.mode, 'hybrid');
    assert.ok(Array.isArray(res.files) && res.files.length >= 1);
    assert.ok(Array.isArray(res.excluded), 'excluded siempre presente en hybrid');
    assert.ok(prompts[0].includes('terraform apply'), 'el fichero completo viaja');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rag.answer: modo desconocido y adapter explícito no permitido fallan claro', async () => {
  const { root, rag } = await makeRag();
  try {
    await assert.rejects(
      () => rag.answer('q', { mode: /** @type {never} */ ('turbo') }),
      /mode/,
    );
    await assert.rejects(
      () => rag.answer('q', { mode: 'cag', adapter: 'claude', adapterExplicit: true }),
      /internal/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
