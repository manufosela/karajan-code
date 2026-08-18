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

test('sigue rechazando una fuente que no apareció en ninguna señal', async () => {
  await assert.rejects(
    () =>
      judgeImpact(
        base([{ source: 'repo-z/inventado.js', severity: 'low', reason: 'me lo he inventado' }]),
      ),
    (err) => err instanceof JudgmentError && err.message.includes('repo-z/inventado.js'),
  );
});
