// @ts-check
/**
 * KJR-TSK-0150 — playground (PR1): POST /answer en el servidor HTTP con
 * los tres modos por el camino guardado (policy + redactPII), registry
 * inyectable y validación estricta. La página llega en la PR2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { indexDirectory } from '../src/easy/indexer.js';
import { loadManifest } from '../src/easy/manifest.js';
import { createRagService } from '../src/easy/rag-service.js';
import { startRagHttpServer } from '../src/easy/http-server.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';

/** Servicio real sobre corpus temporal + servidor en puerto efímero. */
async function startPlaygroundServer(adapterRegistry) {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-playground-'));
  await writeFile(path.join(root, 'guia.md'), '# Guia\nEl despliegue usa terraform apply. Aviso: admin@example.com\n', 'utf8');
  const store = new InMemoryVectorStore({ dimensions: 32 });
  const embedder = createHashEmbedder({ dimensions: 32 });
  await indexDirectory(root, { store, embedder });
  const manifest = await loadManifest(root);
  const service = createRagService({
    rootDir: root,
    manifest: /** @type {never} */ (manifest),
    embedder,
    store: /** @type {never} */ (store),
    storeName: 'in-memory',
  });
  const { server, url } = await startRagHttpServer(service, { port: 0, adapterRegistry });
  return {
    root, server, url,
    close: async () => {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Registry fake que solo responde por ollama y captura prompts. */
function fakeRegistry(prompts) {
  return {
    has: (/** @type {string} */ name) => name === 'ollama',
    get: () => async (/** @type {string} */ prompt) => {
      prompts.push(prompt);
      return { parsedOutput: { text: 'respuesta playground' } };
    },
  };
}

test('POST /answer: responde con adapter de la policy, nivel visible y PII redactada', async () => {
  /** @type {string[]} */
  const prompts = [];
  const ctx = await startPlaygroundServer(fakeRegistry(prompts));
  try {
    const res = await fetch(`${ctx.url}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'como se despliega' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.answer, 'respuesta playground');
    assert.equal(data.adapter, 'ollama', 'default claude → policy enruta a ollama para internal');
    assert.equal(data.sensitivity, 'internal');
    assert.equal(data.mode, 'rag');
    assert.ok(!prompts[0].includes('admin@example.com'), 'la PII no viaja al adapter');
  } finally {
    await ctx.close();
  }
});

test('POST /answer: modo hybrid devuelve files y excluded', async () => {
  const ctx = await startPlaygroundServer(fakeRegistry([]));
  try {
    const res = await fetch(`${ctx.url}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'terraform apply', mode: 'hybrid' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.mode, 'hybrid');
    // Por red viajan CONTEOS, no el inventario de rutas del corpus.
    assert.equal(data.filesCount, 1);
    assert.equal(data.excludedCount, 0);
    assert.equal(data.files, undefined, 'las rutas no se exponen por HTTP');
    assert.equal(data.excluded, undefined);
  } finally {
    await ctx.close();
  }
});

test('POST /answer: los defaults del corpus (karajan.config.json) mandan como en el CLI', async () => {
  const { saveEasyConfig } = await import('../src/easy/config.js');
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-playground-cfg-'));
  try {
    await writeFile(path.join(root, 'faq.md'), '# FAQ\nPreguntas frecuentes del producto.\n', 'utf8');
    await saveEasyConfig(root, { adapter: 'gemini', sensitivity: 'public' });
    const store = new InMemoryVectorStore({ dimensions: 32 });
    const embedder = createHashEmbedder({ dimensions: 32 });
    await indexDirectory(root, { store, embedder, sensitivityFor: () => 'public' });
    const manifest = await loadManifest(root);
    const service = createRagService({
      rootDir: root,
      manifest: /** @type {never} */ (manifest),
      embedder,
      store: /** @type {never} */ (store),
      storeName: 'in-memory',
    });
    const registry = {
      has: (/** @type {string} */ name) => name === 'gemini',
      get: () => async () => ({ parsedOutput: { text: 'via config' } }),
    };
    const { server, url } = await startRagHttpServer(service, { port: 0, adapterRegistry: registry });
    try {
      const res = await fetch(`${url}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'preguntas frecuentes' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.adapter, 'gemini', 'el adapter default sale de karajan.config.json, como en el CLI');
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('answerWithMode: retrieval vacío → statusCode 404, no error genérico', async () => {
  const { answerWithMode } = await import('../src/easy/answer.js');
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-playground-404-'));
  try {
    await writeFile(path.join(root, 'doc.md'), '# Doc\nAlgo.\n', 'utf8');
    const store = new InMemoryVectorStore({ dimensions: 32 });
    const embedder = createHashEmbedder({ dimensions: 32 });
    await indexDirectory(root, { store, embedder });
    const emptyStore = { search: async () => [] };
    await assert.rejects(
      () => answerWithMode({ rootDir: root, store: emptyStore, embedder, question: 'nada' }),
      (err) => /** @type {{ statusCode?: number }} */ (err).statusCode === 404,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('POST /answer: validación estricta — 400 con mensajes accionables', async () => {
  const ctx = await startPlaygroundServer(fakeRegistry([]));
  try {
    const bad = async (/** @type {object} */ body) => {
      const res = await fetch(`${ctx.url}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, data: await res.json() };
    };
    const sinPregunta = await bad({});
    assert.equal(sinPregunta.status, 400);
    assert.ok(sinPregunta.data.error.includes('question'));

    const modoMalo = await bad({ question: 'q', mode: 'turbo' });
    assert.equal(modoMalo.status, 400);
    assert.ok(modoMalo.data.error.includes('mode'));

    const presupuestoMalo = await bad({ question: 'q', maxContextChars: 0 });
    assert.equal(presupuestoMalo.status, 400);
  } finally {
    await ctx.close();
  }
});

test('POST /answer: adapter explícito no permitido → 403 del gate', async () => {
  const ctx = await startPlaygroundServer(fakeRegistry([]));
  try {
    const res = await fetch(`${ctx.url}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'como se despliega', adapter: 'claude' }),
    });
    assert.equal(res.status, 403, 'la elección explícita prohibida es un rechazo del gate, no un 500');
    const data = await res.json();
    assert.ok(data.error.includes('internal'));
  } finally {
    await ctx.close();
  }
});

// --- PR2: la página del playground ---

test('GET /: sirve la página autocontenida con los tres modos', async () => {
  const ctx = await startPlaygroundServer(fakeRegistry([]));
  try {
    const res = await fetch(`${ctx.url}/`);
    assert.equal(res.status, 200);
    assert.ok(String(res.headers.get('content-type')).includes('text/html'));
    const html = await res.text();
    assert.ok(html.includes('karajan-') && html.includes('playground'));
    for (const mode of ['rag', 'cag', 'hybrid']) {
      assert.ok(html.includes(`value="${mode}"`), `selector con modo ${mode}`);
    }
    assert.ok(!/https?:\/\/(?!localhost)/.test(html.replace('http://www.w3.org', '')), 'sin assets externos');
  } finally {
    await ctx.close();
  }
});

test('createRagHttpServer ui:false → GET / responde 404 (solo API)', async () => {
  const { createRagHttpServer } = await import('../src/easy/http-server.js');
  const fakeService = /** @type {never} */ ({ status: async () => ({ ok: true }) });
  const server = createRagHttpServer(fakeService, { ui: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const { port } = /** @type {{ port: number }} */ (server.address());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 404);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});

test('parseServeArgs: --no-ui apaga la página', async () => {
  const { parseServeArgs } = await import('../src/easy/cli.js');
  assert.equal(parseServeArgs(['.', '--http']).ui, true);
  assert.equal(parseServeArgs(['.', '--http', '--no-ui']).ui, false);
});

test('playground: invariantes del script — sin var, sin estado de acción mutable, ARIA presente', async () => {
  // Sin navegador en la suite, estos invariantes estáticos fijan las
  // decisiones de diseño del JS embebido (el linter no ve dentro del
  // template literal): la acción se captura del SubmitEvent.submitter en
  // el propio submit (sin race con awaits), ES2025 (cero `var`) y
  // accesibilidad mínima (labels + aria-live).
  const { PLAYGROUND_HTML } = await import('../src/easy/playground-page.js');
  assert.ok(!/\bvar\s+\w/.test(PLAYGROUND_HTML), 'cero var en el script embebido');
  assert.ok(PLAYGROUND_HTML.includes('ev.submitter'), 'la acción sale del submitter del evento');
  assert.ok(!PLAYGROUND_HTML.includes("addEventListener('click'"), 'sin estado de acción por click');
  assert.equal((PLAYGROUND_HTML.match(/aria-label=/g) ?? []).length >= 3, true, 'inputs etiquetados');
  assert.ok(PLAYGROUND_HTML.includes('aria-live'), 'resultados anunciados a lectores de pantalla');
  assert.ok(!/\.innerHTML\s*=/.test(PLAYGROUND_HTML), 'render solo con textContent (sin asignaciones innerHTML)');
});
