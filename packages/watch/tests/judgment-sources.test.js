// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JudgmentError, judgeImpact } from '../src/judgment.js';

const policy = { confidential: ['ollama'], internal: ['ollama'], public: ['claude'] };

const base = (affected) => ({
  candidates: [
    {
      source: 'repo-b/src/consumer.js',
      repo: 'repo-b',
      score: 0.7,
      evidence: [{ fromChunk: { path: 'src/api.js', newStart: 1 }, line: 2, score: 0.7 }],
    },
  ],
  coChanges: {
    byRepo: [
      {
        repo: 'repo-c',
        coChanges: [{ path: 'docs/history.md', count: 4, lastDate: '2026-01-10T12:00:00Z' }],
      },
    ],
    noSignal: [],
  },
  contracts: [
    {
      source: 'repo-d/src/client.js',
      repo: 'repo-d',
      line: 9,
      tokens: [
        {
          value: '/api/v1/users/:id',
          type: 'http',
          removed: true,
          fromChunk: { path: 'src/api.js', newStart: 1 },
        },
      ],
    },
  ],
  diffSummary: 'repo-a: src/api.js',
  sensitivity: 'public',
  policy,
  runAdapter: async () => JSON.stringify({ summary: 'ok', affected }),
});

test('acepta un veredicto que cita un CO-CAMBIO mostrado en el prompt', async () => {
  // KJW-BUG-0005: esto abortaba el pipeline entero en el primer juicio real.
  const { verdict } = await judgeImpact(
    base([{ source: 'repo-c/docs/history.md', severity: 'medium', reason: 'se movió con este área' }]),
  );
  assert.equal(verdict.affected[0].source, 'repo-c/docs/history.md');
});

test('acepta un veredicto que cita un CONTRATO', async () => {
  const { verdict } = await judgeImpact(
    base([{ source: 'repo-d/src/client.js', severity: 'high', reason: 'usa el endpoint eliminado' }]),
  );
  assert.equal(verdict.affected[0].source, 'repo-d/src/client.js');
});

test('una fuente sin respaldo se DESCARTA con contador — el resto del veredicto sobrevive (KJW-BUG-0010)', async () => {
  // Antes: un solo source inventado tiraba el juicio ENTERO del merge
  // (4/70 abortados en campo). La entrada sin respaldo se descarta y se
  // cuenta; las fundadas se conservan.
  const result = await judgeImpact(
    base([
      { source: 'repo-d/src/client.js', severity: 'high', reason: 'usa el endpoint eliminado' },
      { source: 'repo-z/inventado.js', severity: 'low', reason: 'me lo he inventado' },
    ]),
  );
  assert.equal(result.verdict.affected.length, 1);
  assert.equal(result.verdict.affected[0].source, 'repo-d/src/client.js');
  assert.equal(result.discardedEntries, 1);
});

test('con TODAS las entradas sin respaldo el veredicto queda vacío con contador, nunca error', async () => {
  const result = await judgeImpact(
    base([{ source: 'repo-z/inventado.js', severity: 'low', reason: 'me lo he inventado' }]),
  );
  assert.equal(result.verdict.affected.length, 0);
  assert.equal(result.discardedEntries, 1);
});

test('con las TRES señales vacías no se pide veredicto: informe «sin señal suficiente» (KJW-BUG-0010)', async () => {
  // En campo: 8/8 merges sin retrieval abortaban — y eran los diffs
  // quirúrgicos (1-9 chunks). Sin nada contra lo que validar no hay
  // alucinación que detectar: no se llama al adapter y el informe lo dice.
  let adapterCalled = false;
  const result = await judgeImpact({
    candidates: [],
    coChanges: { byRepo: [], noSignal: [] },
    contracts: [],
    diffSummary: 'repo-a: src/api.js',
    sensitivity: 'public',
    policy,
    runAdapter: async () => {
      adapterCalled = true;
      return JSON.stringify({ summary: 'no debería llegar', affected: [] });
    },
  });
  assert.equal(adapterCalled, false);
  assert.equal(result.insufficientSignal, true);
  assert.equal(result.verdict.affected.length, 0);
  assert.match(result.verdict.summary, /sin señal suficiente/i);
});
