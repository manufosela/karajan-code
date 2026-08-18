// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SolomonRole } from '../src/retrieval/solomon-role.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

function makeCtx() {
  return {
    logger: silentLogger(),
    tools: {
      get: () => { throw new Error('n/a'); },
      has: () => false,
    },
    metadata: {},
    errors: [],
  };
}

/**
 * @param {string} id
 * @param {number} score
 */
function hit(id, score) {
  return { id, score, vector: [0], metadata: { id } };
}

test('SolomonRole majority: chunks comunes a más sources suben en ranking', async () => {
  const solomon = new SolomonRole({ name: 'solomon', logger: silentLogger(), strategy: 'majority' });
  const input = {
    query: 'q',
    sourceResults: [
      { source: 'docs', hits: [hit('a', 0.9), hit('b', 0.8)] },
      { source: 'chat', hits: [hit('a', 0.7), hit('c', 0.85)] },
      { source: 'policy', hits: [hit('a', 0.6)] },
    ],
    maxChunks: 3,
  };
  const ctx = makeCtx();
  const verdict = await solomon.run(input, ctx);
  assert.equal(verdict.strategy, 'majority');
  assert.equal(verdict.chunks[0].id, 'a', 'a aparece en 3 sources → primer puesto');
  assert.equal(verdict.chunks.length, 3);
  // El score de a debe reflejar el bonus de co-ocurrencia (*3)
  assert.ok(verdict.chunks[0].score > 0.9 * 3);
  assert.ok(ctx.metadata.solomonDecision);
  assert.equal(ctx.metadata.solomonDecision.strategy, 'majority');
  assert.deepEqual(ctx.metadata.solomonDecision.selectedIds, ['a', 'c', 'b']);
});

test('SolomonRole weighted: pesos por source inclinan el ranking', async () => {
  const solomon = new SolomonRole({
    name: 'solomon',
    logger: silentLogger(),
    strategy: 'weighted',
    sourceWeights: { authoritative: 2.0, noisy: 0.1 },
  });
  const input = {
    query: 'q',
    sourceResults: [
      { source: 'authoritative', hits: [hit('x', 0.5)] },
      { source: 'noisy', hits: [hit('y', 0.99)] },
    ],
    maxChunks: 2,
  };
  const ctx = makeCtx();
  const verdict = await solomon.run(input, ctx);
  assert.equal(verdict.strategy, 'weighted');
  // x: 0.5 * 2.0 = 1.0;  y: 0.99 * 0.1 = 0.099. x debe ganar.
  assert.equal(verdict.chunks[0].id, 'x');
  assert.equal(verdict.chunks[1].id, 'y');
  assert.equal(verdict.sourceWeights.authoritative, 2.0);
  assert.equal(verdict.sourceWeights.noisy, 0.1);
});

test('SolomonRole weighted: source sin peso definido usa 1.0', async () => {
  const solomon = new SolomonRole({
    name: 'solomon',
    logger: silentLogger(),
    strategy: 'weighted',
    sourceWeights: { a: 3.0 },
  });
  const input = {
    query: 'q',
    sourceResults: [
      { source: 'a', hits: [hit('x', 0.3)] },     // 0.3 * 3 = 0.9
      { source: 'unknown', hits: [hit('y', 0.8)] }, // 0.8 * 1 = 0.8
    ],
  };
  const verdict = await solomon.run(input, makeCtx());
  assert.equal(verdict.chunks[0].id, 'x');
});

test('SolomonRole llm-arbiter: delega al callback y normaliza verdict', async () => {
  /** @type {any} */
  let received = null;
  const solomon = new SolomonRole({
    name: 'solomon',
    logger: silentLogger(),
    strategy: 'llm-arbiter',
    arbiter: async ({ query, candidates, sources }) => {
      received = { query, candidatesCount: candidates.length, sources };
      return {
        chunks: candidates.slice(0, 2),
        rationale: 'arbitró el juez',
      };
    },
  });
  const input = {
    query: '¿cuál es la política?',
    sourceResults: [
      { source: 'docs', hits: [hit('a', 0.9)] },
      { source: 'policy', hits: [hit('b', 0.8), hit('a', 0.7)] },
    ],
    maxChunks: 5,
  };
  const verdict = await solomon.run(input, makeCtx());
  assert.equal(verdict.strategy, 'llm-arbiter');
  assert.equal(received.query, '¿cuál es la política?');
  assert.equal(received.candidatesCount, 2, 'a y b deduplicados');
  assert.deepEqual(received.sources, ['docs', 'policy']);
  assert.equal(verdict.rationale, 'arbitró el juez');
  assert.equal(verdict.chunks.length, 2);
});

test('SolomonRole llm-arbiter: sin arbiter en constructor lanza', () => {
  assert.throws(
    () => new SolomonRole({ name: 's', logger: silentLogger(), strategy: 'llm-arbiter' }),
    /arbiter/,
  );
});

test('SolomonRole: input inválido lanza', async () => {
  const solomon = new SolomonRole({ name: 's', logger: silentLogger() });
  await assert.rejects(
    () => solomon.run(/** @type {any} */ ({}), makeCtx()),
    /sourceResults/,
  );
});

test('SolomonRole: respeta maxChunks', async () => {
  const solomon = new SolomonRole({ name: 's', logger: silentLogger(), strategy: 'majority' });
  const input = {
    query: 'q',
    sourceResults: [
      { source: 's1', hits: [hit('a', 1), hit('b', 0.9), hit('c', 0.8), hit('d', 0.7)] },
    ],
    maxChunks: 2,
  };
  const verdict = await solomon.run(input, makeCtx());
  assert.equal(verdict.chunks.length, 2);
  assert.equal(verdict.chunks[0].id, 'a');
});

test('SolomonRole: strategy por defecto es "majority"', async () => {
  const solomon = new SolomonRole({ name: 's', logger: silentLogger() });
  const input = {
    query: 'q',
    sourceResults: [{ source: 's', hits: [hit('a', 1)] }],
  };
  const verdict = await solomon.run(input, makeCtx());
  assert.equal(verdict.strategy, 'majority');
});

test('SolomonRole: ctx.metadata.solomonDecision incluye sourcesCount y selectedIds', async () => {
  const solomon = new SolomonRole({ name: 's', logger: silentLogger(), strategy: 'weighted' });
  const input = {
    query: 'q',
    sourceResults: [
      { source: 'x', hits: [hit('1', 0.5)] },
      { source: 'y', hits: [hit('2', 0.5)] },
    ],
  };
  const ctx = makeCtx();
  await solomon.run(input, ctx);
  const dec = ctx.metadata.solomonDecision;
  assert.equal(dec.strategy, 'weighted');
  assert.equal(dec.sourcesCount, 2);
  assert.deepEqual(new Set(dec.selectedIds), new Set(['1', '2']));
});
