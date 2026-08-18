// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultRoleRegistry } from '../src/registry/default-role-registry.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { AdapterRegistry } from '../src/ai/adapter-registry.js';
import { createDefaultSensitivityPolicy } from '../src/policy/sensitivity-policy.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function stubAdapter() {
  return async () => ({
    provider: 'stub',
    process: { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false },
    parsedOutput: { format: 'json', json: { answer: 'x' }, text: '' },
  });
}

test('createDefaultRoleRegistry: registra retriever si hay embedder+store', () => {
  const reg = createDefaultRoleRegistry({
    logger: silentLogger(),
    embedder: createHashEmbedder({ dimensions: 8 }),
    store: new InMemoryVectorStore({ dimensions: 8 }),
  });
  assert.equal(reg.has('retriever'), true);
  assert.equal(reg.has('generator'), false);
  assert.equal(reg.has('evaluator'), false);
});

test('createDefaultRoleRegistry: registra generator/evaluator si hay adapterRegistry', () => {
  const adapters = new AdapterRegistry();
  adapters.register('claude', stubAdapter());
  adapters.register('codex', stubAdapter());
  adapters.register('gemini', stubAdapter());
  const reg = createDefaultRoleRegistry({
    logger: silentLogger(),
    adapterRegistry: adapters,
  });
  assert.equal(reg.has('generator'), true);
  assert.equal(reg.has('evaluator'), true);
  assert.equal(reg.has('reranker-score'), true);
  assert.equal(reg.has('reranker-llm'), true);
});

test('createDefaultRoleRegistry: registra redaction si hay policy', () => {
  const reg = createDefaultRoleRegistry({
    logger: silentLogger(),
    policy: createDefaultSensitivityPolicy(),
  });
  assert.equal(reg.has('redaction'), true);
});

test('createDefaultRoleRegistry: factory devuelve instancias nuevas cada vez', () => {
  const reg = createDefaultRoleRegistry({
    logger: silentLogger(),
    embedder: createHashEmbedder({ dimensions: 8 }),
    store: new InMemoryVectorStore({ dimensions: 8 }),
  });
  const a = reg.resolve('retriever');
  const b = reg.resolve('retriever');
  assert.notStrictEqual(a, b);
});

test('createDefaultRoleRegistry: falta logger lanza', () => {
  // @ts-expect-error missing
  assert.throws(() => createDefaultRoleRegistry({}), /logger/);
});
