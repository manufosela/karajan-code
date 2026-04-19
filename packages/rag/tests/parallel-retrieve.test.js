// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parallelRetrieve } from '../src/retrieval/parallel-retrieve.js';
import { SolomonRole } from '../src/retrieval/solomon-role.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

function hit(id, score) {
  return { id, score, vector: [0], metadata: { id } };
}

test('parallelRetrieve: ejecuta todas las sources en paralelo y preserva orden', async () => {
  const sources = [
    { source: 'a', retrieve: async () => [hit('a1', 0.9)] },
    { source: 'b', retrieve: async () => [hit('b1', 0.8)] },
    { source: 'c', retrieve: async () => [hit('c1', 0.7)] },
  ];
  const result = await parallelRetrieve(sources, 'q');
  assert.equal(result.length, 3);
  assert.equal(result[0].source, 'a');
  assert.equal(result[1].source, 'b');
  assert.equal(result[2].source, 'c');
  assert.equal(result[0].hits[0].id, 'a1');
});

test('parallelRetrieve: source que lanza no aborta, devuelve hits=[]', async () => {
  const warnings = [];
  const logger = {
    info: () => {},
    warn: (msg) => warnings.push(msg),
    error: () => {},
    debug: () => {},
  };
  const sources = [
    { source: 'ok', retrieve: async () => [hit('x', 0.9)] },
    { source: 'broken', retrieve: async () => { throw new Error('pum'); } },
  ];
  const result = await parallelRetrieve(sources, 'q', { logger });
  assert.equal(result.length, 2);
  assert.deepEqual(result[1].hits, []);
  assert.equal(result[0].hits[0].id, 'x');
  assert.ok(warnings.some((w) => /broken.*pum/.test(w)));
});

test('parallelRetrieve: timeoutMs corta sources lentas sin parar al resto', async () => {
  const sources = [
    { source: 'fast', retrieve: async () => [hit('f', 0.9)] },
    {
      source: 'slow',
      retrieve: () => new Promise((r) => setTimeout(() => r([hit('s', 0.8)]), 100)),
    },
  ];
  const result = await parallelRetrieve(sources, 'q', { timeoutMs: 20, logger: silentLogger() });
  assert.equal(result[0].hits.length, 1, 'fast debe resolver');
  assert.equal(result[1].hits.length, 0, 'slow debe caer por timeout');
});

test('parallelRetrieve: sin timeoutMs una source lenta espera a terminar', async () => {
  const sources = [
    {
      source: 'slow',
      retrieve: () => new Promise((r) => setTimeout(() => r([hit('s', 0.8)]), 25)),
    },
  ];
  const result = await parallelRetrieve(sources, 'q');
  assert.equal(result[0].hits.length, 1);
});

test('parallelRetrieve: output directamente utilizable por SolomonRole', async () => {
  const sources = [
    { source: 'docs', retrieve: async () => [hit('A', 0.9), hit('B', 0.8)] },
    { source: 'chat', retrieve: async () => [hit('A', 0.7)] },
  ];
  const sourceResults = await parallelRetrieve(sources, 'q');
  const solomon = new SolomonRole({
    name: 's',
    logger: silentLogger(),
    strategy: 'majority',
  });
  const ctx = {
    logger: silentLogger(),
    tools: { get: () => { throw new Error('n/a'); }, has: () => false },
    metadata: {},
    errors: [],
  };
  const verdict = await solomon.run({ query: 'q', sourceResults }, ctx);
  // A aparece en 2 sources → debe ir primero
  assert.equal(verdict.chunks[0].id, 'A');
  assert.equal(ctx.metadata.solomonDecision.sourcesCount, 2);
});

test('parallelRetrieve: sources inválido lanza', async () => {
  await assert.rejects(
    () => parallelRetrieve(/** @type {any} */ ('not-array'), 'q'),
    /sources/,
  );
});

test('parallelRetrieve: query no-string lanza', async () => {
  await assert.rejects(
    () => parallelRetrieve([], /** @type {any} */ (42)),
    /query/,
  );
});

test('parallelRetrieve: retrieve que devuelve null/undefined se normaliza a []', async () => {
  const sources = [
    { source: 'nullish', retrieve: async () => /** @type {any} */ (null) },
  ];
  const result = await parallelRetrieve(sources, 'q');
  assert.deepEqual(result[0].hits, []);
});
