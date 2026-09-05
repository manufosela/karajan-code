// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JudgmentError, JUDGMENT_TIMEOUT_MS, judgeImpact } from '../src/judgment.js';

// Con las tres señales vacías judgeImpact ya NO llama al adapter
// (KJW-BUG-0010), así que estos tests necesitan al menos un candidato
// para seguir ejercitando el camino del timeout que dicen probar.
const params = (runAdapter, extra = {}) => ({
  candidates: [
    {
      source: 'repo-b/src/consumer.js',
      repo: 'repo-b',
      score: 0.7,
      evidence: [{ fromChunk: { path: 'src/api.js', newStart: 1 }, line: 2, score: 0.7 }],
    },
  ],
  coChanges: { byRepo: [], noSignal: [] },
  diffSummary: 'repo-a: src/api.js',
  sensitivity: 'public',
  policy: { confidential: ['ollama'], internal: ['ollama'], public: ['claude'] },
  runAdapter,
  ...extra,
});

test('hay un timeout por defecto declarado', () => {
  assert.ok(JUDGMENT_TIMEOUT_MS > 0);
});

test('si el adapter no responde a tiempo, JudgmentError explícito', async () => {
  // KJW-BUG-0006: sin esto el job se queda colgado hasta el tope del runner.
  const nunca = () => new Promise(() => {});
  await assert.rejects(
    () => judgeImpact(params(nunca, { timeoutMs: 40 })),
    (err) =>
      err instanceof JudgmentError &&
      /40\s*ms|no respondió/i.test(err.message) &&
      err.message.includes('claude'),
  );
});

test('el timeout no penaliza a un adapter que responde a tiempo', async () => {
  const rapido = async () => JSON.stringify({ summary: 'ok', affected: [] });
  const { verdict } = await judgeImpact(params(rapido, { timeoutMs: 5000 }));
  assert.equal(verdict.summary, 'ok');
});

test('el temporizador no deja el proceso vivo tras terminar', async () => {
  // Si el timer no se limpia, node no cierra: se detecta porque el test
  // termina pero el handle sigue activo.
  const rapido = async () => JSON.stringify({ summary: 'ok', affected: [] });
  await judgeImpact(params(rapido, { timeoutMs: 60000 }));
  const pendientes = process.getActiveResourcesInfo().filter((r) => r === 'Timeout');
  assert.equal(pendientes.length, 0, 'quedó un temporizador sin limpiar');
});
