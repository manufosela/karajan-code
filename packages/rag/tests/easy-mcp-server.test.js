// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { indexDirectory } from '../src/easy/indexer.js';
import { loadManifest } from '../src/easy/manifest.js';
import { createRagService } from '../src/easy/rag-service.js';
import { handleMcpMessage, startRagMcpServer } from '../src/easy/mcp-server.js';
import { parseServeArgs } from '../src/easy/cli.js';

async function makeService() {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-mcp-'));
  await writeFile(path.join(root, 'faq.md'), '# FAQ\nLos envíos tardan 48 horas.\n', 'utf8');
  const embedder = createHashEmbedder({ dimensions: 32 });
  const store = new InMemoryVectorStore({ dimensions: 32 });
  await indexDirectory(root, { store, embedder });
  const manifest = await loadManifest(root);
  assert.ok(manifest);
  return {
    root,
    service: createRagService({ rootDir: root, manifest, embedder, store, storeName: 'in-memory' }),
  };
}

test('handleMcpMessage: initialize responde protocolo, capabilities y serverInfo', async () => {
  const { root, service } = await makeService();
  try {
    const res = await handleMcpMessage(service, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });
    assert.equal(res?.id, 1);
    const result = /** @type {any} */ (res).result;
    assert.equal(result.protocolVersion, '2025-06-18');
    assert.equal(result.serverInfo.name, 'karajan-rag');
    assert.ok('tools' in result.capabilities);
    assert.equal(await handleMcpMessage(service, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('handleMcpMessage: tools/list expone rag_query y rag_status', async () => {
  const { root, service } = await makeService();
  try {
    const res = /** @type {any} */ (await handleMcpMessage(service, { jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    const names = res.result.tools.map((/** @type {any} */ t) => t.name);
    assert.deepEqual(names, ['rag_query', 'rag_status']);
    assert.deepEqual(res.result.tools[0].inputSchema.required, ['question']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('handleMcpMessage: tools/call ejecuta rag_query y rag_status', async () => {
  const { root, service } = await makeService();
  try {
    const query = /** @type {any} */ (
      await handleMcpMessage(service, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'rag_query', arguments: { question: 'envíos 48 horas', topK: 2 } },
      })
    );
    const payload = JSON.parse(query.result.content[0].text);
    assert.ok(payload.hits.length >= 1);
    assert.equal(payload.hits[0].source, 'faq.md');

    const status = /** @type {any} */ (
      await handleMcpMessage(service, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'rag_status', arguments: {} },
      })
    );
    assert.equal(JSON.parse(status.result.content[0].text).files, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('handleMcpMessage: tool desconocida → isError; método desconocido → -32601', async () => {
  const { root, service } = await makeService();
  try {
    const bad = /** @type {any} */ (
      await handleMcpMessage(service, {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'nope', arguments: {} },
      })
    );
    assert.equal(bad.result.isError, true);

    const unknown = /** @type {any} */ (
      await handleMcpMessage(service, { jsonrpc: '2.0', id: 6, method: 'recursos/list' })
    );
    assert.equal(unknown.error.code, -32601);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('startRagMcpServer: round-trip por streams y JSON malformado → -32700', async () => {
  const { root, service } = await makeService();
  const input = new PassThrough();
  const output = new PassThrough();
  const server = startRagMcpServer(service, { input, output });
  try {
    const lines = [];
    output.on('data', (chunk) => lines.push(...chunk.toString().split('\n').filter(Boolean)));

    input.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
    input.write('esto no es json\n');
    await new Promise((resolve) => setTimeout(resolve, 50));

    // JSON-RPC no garantiza orden de respuestas: se correlaciona por id.
    assert.equal(lines.length, 2);
    const parsed = lines.map((l) => JSON.parse(l));
    const listResponse = parsed.find((m) => m.id === 1);
    const parseError = parsed.find((m) => m.id === null);
    assert.equal(listResponse.result.tools.length, 2);
    assert.equal(parseError.error.code, -32700);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('parseServeArgs: defaults, excluyentes y validación', () => {
  const opts = parseServeArgs([]);
  assert.equal(opts.mode, 'mcp');
  assert.equal(opts.port, 8080);
  assert.equal(opts.store, 'lancedb');

  const http = parseServeArgs(['./docs', '--http', '--port', '0']);
  assert.equal(http.mode, 'http');
  assert.equal(http.port, 0);

  assert.throws(() => parseServeArgs(['--http', '--mcp']), /excluyentes/);
  assert.throws(() => parseServeArgs(['--store', 'in-memory']), /--store/);
  assert.throws(() => parseServeArgs(['--port', 'ochenta']), /--port/);
});
