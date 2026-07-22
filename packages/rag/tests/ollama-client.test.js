// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaClient } from '../src/ai/adapters/ollama-client.js';

test('createOllamaClient: expone las tres piezas con config compartida', () => {
  const client = createOllamaClient({ fetchImpl: /** @type {never} */ (async () => {}) });
  assert.equal(typeof client.adapter, 'function');
  assert.equal(typeof client.streamAdapter, 'function');
  assert.equal(typeof client.embedder.embedBatch, 'function');
  assert.equal(client.embedder.dimensions, 768);
  assert.equal(client.baseUrl, 'http://localhost:11434');
});

test('adapter: POST /api/generate blocking devuelve AdapterResult', async () => {
  const calls = [];
  const fetchImpl = /** @type {typeof fetch} */ (/** @type {unknown} */ (async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({ response: 'hola desde llama', eval_count: 7, done: true }),
    };
  }));
  const client = createOllamaClient({ baseUrl: 'http://ollama.local/', model: 'mistral', fetchImpl });
  const res = await client.adapter('hola');
  assert.equal(res.provider, 'ollama-http');
  assert.equal(res.process.exitCode, 0);
  assert.equal(/** @type {any} */ (res.parsedOutput.json).answer, 'hola desde llama');
  assert.equal(res.providerMeta.evalCount, 7);

  assert.equal(calls[0].url, 'http://ollama.local/api/generate');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'mistral');
  assert.equal(body.stream, false);
});

test('adapter: error HTTP produce exitCode 1; maxTokens viaja como num_predict', async () => {
  const calls = [];
  let status = 500;
  const fetchImpl = /** @type {typeof fetch} */ (/** @type {unknown} */ (async (url, init) => {
    calls.push({ url, init });
    return { ok: status === 200, status, statusText: 'X', text: async () => 'boom' };
  }));
  const client = createOllamaClient({ fetchImpl, maxTokens: 256 });
  const res = await client.adapter('hola');
  assert.equal(res.process.exitCode, 1);
  assert.match(res.process.stderr, /HTTP 500/);
  assert.equal(JSON.parse(calls[0].init.body).options.num_predict, 256);

  status = 200;
});

test('streamAdapter y embedder comparten el baseUrl del factory', async () => {
  const urls = [];
  const fetchImpl = /** @type {typeof fetch} */ (/** @type {unknown} */ (async (url) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: null,
      text: async () => JSON.stringify({ data: [{ embedding: new Array(8).fill(0.5) }] }),
      json: async () => ({ data: [{ embedding: new Array(8).fill(0.5) }] }),
    };
  }));
  const client = createOllamaClient({
    baseUrl: 'http://compartido:11434',
    dimensions: 8,
    fetchImpl,
  });
  await client.embedder.embed('hola');
  assert.ok(urls[0].startsWith('http://compartido:11434/'), `embedder usa el baseUrl: ${urls[0]}`);
});
