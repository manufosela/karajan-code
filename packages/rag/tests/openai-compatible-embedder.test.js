// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOpenAICompatibleEmbedder,
  createOllamaEmbedder,
} from '../src/embedding/openai-compatible-embedder.js';

/**
 * Mock fetch que devuelve la respuesta deterministista configurada.
 *
 * @param {(url: string, init: RequestInit) => { status: number, body: any }} handler
 */
function mockFetch(handler) {
  return async (url, init) => {
    const out = handler(String(url), init ?? {});
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      statusText: `Mock ${out.status}`,
      async json() {
        return out.body;
      },
      async text() {
        return JSON.stringify(out.body);
      },
    };
  };
}

test('createOpenAICompatibleEmbedder: embed single envía model+input y parsea data[0].embedding', async () => {
  let capturedBody = null;
  let capturedHeaders = null;
  let capturedUrl = null;

  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    capturedBody = JSON.parse(String(init.body));
    return {
      status: 200,
      body: { data: [{ embedding: new Array(4).fill(0.25) }] },
    };
  });

  const e = createOpenAICompatibleEmbedder({
    baseUrl: 'http://example/',
    model: 'test-model',
    dimensions: 4,
    fetchImpl,
  });

  const v = await e.embed('hola');
  assert.deepEqual(v, [0.25, 0.25, 0.25, 0.25]);
  assert.equal(capturedUrl, 'http://example/v1/embeddings');
  assert.equal(capturedBody.model, 'test-model');
  assert.equal(capturedBody.input, 'hola');
  assert.equal(capturedHeaders['Content-Type'], 'application/json');
  assert.equal(capturedHeaders.Authorization, undefined);
});

test('createOpenAICompatibleEmbedder: apiKey se envía como Bearer', async () => {
  let capturedAuth = null;
  const fetchImpl = mockFetch((_u, init) => {
    capturedAuth = init.headers.Authorization;
    return { status: 200, body: { data: [{ embedding: [1, 0] }] } };
  });
  const e = createOpenAICompatibleEmbedder({
    baseUrl: 'http://x',
    model: 'm',
    dimensions: 2,
    apiKey: 'secret-123',
    fetchImpl,
  });
  await e.embed('x');
  assert.equal(capturedAuth, 'Bearer secret-123');
});

test('createOpenAICompatibleEmbedder: embedBatch envía array', async () => {
  let capturedBody = null;
  const fetchImpl = mockFetch((_u, init) => {
    capturedBody = JSON.parse(String(init.body));
    return {
      status: 200,
      body: {
        data: [
          { embedding: [1, 0] },
          { embedding: [0, 1] },
          { embedding: [1, 1] },
        ],
      },
    };
  });
  const e = createOpenAICompatibleEmbedder({
    baseUrl: 'http://x',
    model: 'm',
    dimensions: 2,
    fetchImpl,
  });
  const vectors = await e.embedBatch(['a', 'b', 'c']);
  assert.equal(vectors.length, 3);
  assert.deepEqual(capturedBody.input, ['a', 'b', 'c']);
});

test('createOpenAICompatibleEmbedder: embedBatch vacío devuelve array vacío sin fetch', async () => {
  let called = false;
  const fetchImpl = mockFetch(() => {
    called = true;
    return { status: 200, body: { data: [] } };
  });
  const e = createOpenAICompatibleEmbedder({
    baseUrl: 'http://x',
    model: 'm',
    dimensions: 2,
    fetchImpl,
  });
  const vectors = await e.embedBatch([]);
  assert.deepEqual(vectors, []);
  assert.equal(called, false);
});

test('createOpenAICompatibleEmbedder: dimensión mismatch lanza', async () => {
  const fetchImpl = mockFetch(() => ({
    status: 200,
    body: { data: [{ embedding: [1, 2, 3] }] },
  }));
  const e = createOpenAICompatibleEmbedder({
    baseUrl: 'http://x',
    model: 'm',
    dimensions: 4,
    fetchImpl,
  });
  await assert.rejects(() => e.embed('x'), /dimensi\u00f3n 3 != esperada 4/);
});

test('createOpenAICompatibleEmbedder: HTTP 500 propaga con status', async () => {
  const fetchImpl = mockFetch(() => ({ status: 500, body: { error: 'server down' } }));
  const e = createOpenAICompatibleEmbedder({
    baseUrl: 'http://x',
    model: 'm',
    dimensions: 2,
    fetchImpl,
  });
  await assert.rejects(() => e.embed('x'), /HTTP 500/);
});

test('createOpenAICompatibleEmbedder: valida args requeridos', () => {
  assert.throws(
    // @ts-expect-error missing
    () => createOpenAICompatibleEmbedder({ model: 'm', dimensions: 2 }),
    /baseUrl/,
  );
  assert.throws(
    // @ts-expect-error missing
    () => createOpenAICompatibleEmbedder({ baseUrl: 'http://x', dimensions: 2 }),
    /model/,
  );
  assert.throws(
    () => createOpenAICompatibleEmbedder({ baseUrl: 'http://x', model: 'm', dimensions: 0 }),
    /dimensions/,
  );
});

test('createOpenAICompatibleEmbedder: path override respetado', async () => {
  let capturedUrl = null;
  const fetchImpl = mockFetch((url) => {
    capturedUrl = url;
    return { status: 200, body: { data: [{ embedding: [0, 0] }] } };
  });
  const e = createOpenAICompatibleEmbedder({
    baseUrl: 'http://x',
    model: 'm',
    dimensions: 2,
    path: '/api/embeddings',
    fetchImpl,
  });
  await e.embed('x');
  assert.equal(capturedUrl, 'http://x/api/embeddings');
});

test('createOllamaEmbedder: preset apunta a localhost:11434 con nomic 768', async () => {
  let capturedUrl = null;
  let capturedBody = null;
  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(String(init.body));
    return { status: 200, body: { data: [{ embedding: new Array(768).fill(0.1) }] } };
  });
  const e = createOllamaEmbedder({ fetchImpl });
  assert.equal(e.dimensions, 768);
  const v = await e.embed('test');
  assert.equal(v.length, 768);
  assert.equal(capturedUrl, 'http://localhost:11434/v1/embeddings');
  assert.equal(capturedBody.model, 'nomic-embed-text');
});

test('createOllamaEmbedder: overrides de baseUrl, model y dimensions', async () => {
  let capturedUrl = null;
  let capturedBody = null;
  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(String(init.body));
    return { status: 200, body: { data: [{ embedding: new Array(1024).fill(0.5) }] } };
  });
  const e = createOllamaEmbedder({
    baseUrl: 'http://other:9999',
    model: 'mxbai-embed-large',
    dimensions: 1024,
    fetchImpl,
  });
  await e.embed('x');
  assert.equal(capturedUrl, 'http://other:9999/v1/embeddings');
  assert.equal(capturedBody.model, 'mxbai-embed-large');
  assert.equal(e.dimensions, 1024);
});
