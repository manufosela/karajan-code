// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOllamaStreamAdapter,
  readNdjsonLines,
} from '../src/ai/adapters/ollama-stream-adapter.js';

/**
 * Construye un ReadableStream de Uint8Array que emite los `chunks` pasados
 * en strings separados por los límites exactos que le digamos.
 * @param {string[]} chunks
 */
function makeReadableStream(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
}

/**
 * Mock fetch que captura url/body y devuelve una Response con el stream dado.
 */
function makeMockFetch({ status = 200, bodyChunks }) {
  let lastCall = null;
  const fetchImpl = async (url, init) => {
    lastCall = { url: String(url), init };
    if (status < 200 || status >= 300) {
      return {
        ok: false,
        status,
        statusText: `Mock ${status}`,
        body: null,
        async text() { return 'boom'; },
      };
    }
    return {
      ok: true,
      status,
      statusText: 'OK',
      body: makeReadableStream(bodyChunks),
      async text() { return bodyChunks.join(''); },
    };
  };
  return { fetchImpl, get lastCall() { return lastCall; } };
}

test('createOllamaStreamAdapter: exige model', () => {
  assert.throws(() => createOllamaStreamAdapter(/** @type {any} */ ({})), /model/);
});

test('createOllamaStreamAdapter: emite los "response" de cada línea NDJSON en orden', async () => {
  const mock = makeMockFetch({
    bodyChunks: [
      '{"response":"Hola","done":false}\n',
      '{"response":" mundo","done":false}\n',
      '{"response":"!","done":true}\n',
    ],
  });
  const stream = createOllamaStreamAdapter({
    baseUrl: 'http://localhost:11434',
    model: 'llama3',
    fetchImpl: mock.fetchImpl,
  });
  const out = [];
  for await (const chunk of stream('Saluda')) {
    out.push(chunk);
  }
  assert.deepEqual(out, ['Hola', ' mundo', '!']);
  assert.equal(mock.lastCall.url, 'http://localhost:11434/api/generate');
  const body = JSON.parse(mock.lastCall.init.body);
  assert.equal(body.model, 'llama3');
  assert.equal(body.prompt, 'Saluda');
  assert.equal(body.stream, true);
});

test('createOllamaStreamAdapter: baseUrl con trailing slash se normaliza', async () => {
  const mock = makeMockFetch({ bodyChunks: ['{"response":"ok","done":true}\n'] });
  const stream = createOllamaStreamAdapter({
    baseUrl: 'http://localhost:11434/',
    model: 'm',
    fetchImpl: mock.fetchImpl,
  });
  for await (const _c of stream('x')) void _c;
  assert.equal(mock.lastCall.url, 'http://localhost:11434/api/generate');
});

test('createOllamaStreamAdapter: done=true corta la iteración aunque venga más', async () => {
  const mock = makeMockFetch({
    bodyChunks: [
      '{"response":"A","done":false}\n',
      '{"response":"B","done":true}\n',
      '{"response":"C","done":false}\n',
    ],
  });
  const stream = createOllamaStreamAdapter({ model: 'm', fetchImpl: mock.fetchImpl });
  const out = [];
  for await (const c of stream('x')) out.push(c);
  assert.deepEqual(out, ['A', 'B']);
});

test('createOllamaStreamAdapter: líneas malformadas se ignoran sin romper', async () => {
  const mock = makeMockFetch({
    bodyChunks: [
      'not-json\n',
      '{"response":"ok","done":false}\n',
      '{not even close}\n',
      '{"response":" y","done":true}\n',
    ],
  });
  const stream = createOllamaStreamAdapter({ model: 'm', fetchImpl: mock.fetchImpl });
  const out = [];
  for await (const c of stream('x')) out.push(c);
  assert.deepEqual(out, ['ok', ' y']);
});

test('createOllamaStreamAdapter: HTTP !=2xx lanza con código y cuerpo', async () => {
  const mock = makeMockFetch({ status: 500, bodyChunks: [] });
  const stream = createOllamaStreamAdapter({ model: 'm', fetchImpl: mock.fetchImpl });
  await assert.rejects(async () => {
    for await (const _c of stream('x')) void _c;
  }, /HTTP 500/);
});

test('createOllamaStreamAdapter: prompt no-string lanza', async () => {
  const stream = createOllamaStreamAdapter({ model: 'm', fetchImpl: async () => { throw new Error('should not call'); } });
  await assert.rejects(async () => {
    for await (const _c of stream(/** @type {any} */ (42))) void _c;
  }, /prompt debe ser string/);
});

test('readNdjsonLines: trozos partidos a mitad de línea se reensamblan', async () => {
  const body = makeReadableStream([
    '{"response":"He',
    'llo","d',
    'one":false}\n{"response":"!"',
    ',"done":true}\n',
  ]);
  const lines = [];
  for await (const line of readNdjsonLines(body)) {
    lines.push(JSON.parse(line));
  }
  assert.equal(lines.length, 2);
  assert.equal(lines[0].response, 'Hello');
  assert.equal(lines[1].response, '!');
});

test('readNdjsonLines: tail sin \\n final también se emite', async () => {
  const body = makeReadableStream([
    '{"response":"a","done":false}\n',
    '{"response":"b","done":true}', // sin \n
  ]);
  const lines = [];
  for await (const line of readNdjsonLines(body)) {
    lines.push(JSON.parse(line));
  }
  assert.equal(lines.length, 2);
  assert.equal(lines[1].response, 'b');
});
