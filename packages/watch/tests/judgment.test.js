// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JudgmentError,
  buildJudgmentPrompt,
  parseVerdict,
  judgeImpact,
} from '../src/judgment.js';

const policy = {
  confidential: ['ollama'],
  internal: ['ollama', 'azure-openai'],
  public: ['claude', 'codex'],
};

const candidates = [
  {
    source: 'repo-b/src/consumer.js',
    repo: 'repo-b',
    score: 0.9,
    evidence: [{ fromChunk: { path: 'src/api.js', newStart: 10 }, line: 5, score: 0.9 }],
  },
  {
    source: 'repo-c/src/client.js',
    repo: 'repo-c',
    score: 0.5,
    evidence: [{ fromChunk: { path: 'src/api.js', newStart: 10 }, line: 2, score: 0.5 }],
  },
];

const coChanges = {
  byRepo: [
    { repo: 'repo-b', coChanges: [{ path: 'src/consumer.js', count: 3, lastDate: '2026-01-10T12:00:00Z' }] },
  ],
  noSignal: [{ repo: 'repo-c', reason: 'sin historial git disponible.' }],
};

const validVerdict = JSON.stringify({
  summary: 'El cambio de timeout afecta al consumidor.',
  affected: [
    { source: 'repo-b/src/consumer.js', severity: 'high', reason: 'usa el endpoint modificado' },
  ],
});

const baseParams = (overrides = {}) => ({
  candidates,
  coChanges,
  diffSummary: 'repo-a: src/api.js (2 hunks)',
  sensitivity: 'internal',
  policy,
  runAdapter: async () => validVerdict,
  ...overrides,
});

test('adapter explícito no permitido: JudgmentError, nunca degradación silenciosa', async () => {
  await assert.rejects(
    () => judgeImpact(baseParams({ adapter: 'claude' })),
    (err) =>
      err instanceof JudgmentError &&
      err.message.includes('claude') &&
      err.message.includes('internal'),
  );
});

test('sin adapter explícito: usa el primero permitido por la policy', async () => {
  /** @type {string[]} */
  const used = [];
  const result = await judgeImpact(
    baseParams({
      runAdapter: async (adapterName) => {
        used.push(adapterName);
        return validVerdict;
      },
    }),
  );
  assert.deepEqual(used, ['ollama']);
  assert.equal(result.adapter, 'ollama');
});

test('nivel sin providers en la policy: error explícito', async () => {
  await assert.rejects(
    () => judgeImpact(baseParams({ policy: { ...policy, internal: [] } })),
    JudgmentError,
  );
});

test('parseVerdict: acepta JSON con fences y texto alrededor', () => {
  const wrapped = `Aquí va mi análisis:\n\`\`\`json\n${validVerdict}\n\`\`\`\nEspero que ayude.`;
  const verdict = parseVerdict(wrapped);
  assert.equal(verdict.affected[0].severity, 'high');
});

test('parseVerdict: JSON inválido o esquema roto = JudgmentError', () => {
  // @ts-expect-error — valor no-string a propósito (integración rota)
  assert.throws(() => parseVerdict(null), JudgmentError);
  assert.throws(() => parseVerdict('no hay json aquí'), JudgmentError);
  assert.throws(() => parseVerdict('{"summary": 1, "affected": []}'), JudgmentError);
  assert.throws(
    () => parseVerdict('{"summary": "ok", "affected": [{"source": "x"}]}'),
    JudgmentError,
  );
  assert.throws(
    () =>
      parseVerdict(
        '{"summary": "ok", "affected": [{"source": "x", "severity": "catastrófica", "reason": "y"}]}',
      ),
    (err) => err instanceof JudgmentError && err.message.includes('severity'),
  );
});

test('source alucinado (no está entre los candidatos): se descarta con contador, sin abortar', async () => {
  // KJW-BUG-0010: antes esto lanzaba JudgmentError y tiraba el juicio
  // entero del merge. La entrada sin respaldo se descarta y se cuenta.
  const hallucinated = JSON.stringify({
    summary: 'ok',
    affected: [{ source: 'repo-z/invento.js', severity: 'low', reason: 'x' }],
  });
  const result = await judgeImpact(baseParams({ runAdapter: async () => hallucinated }));
  assert.equal(result.verdict.affected.length, 0);
  assert.equal(result.discardedEntries, 1);
});

test('redactPII aplicado a summary y reasons', async () => {
  const leaky = JSON.stringify({
    summary: 'Avisar a persona@example.com del cambio.',
    affected: [
      {
        source: 'repo-b/src/consumer.js',
        severity: 'medium',
        reason: 'el contacto es otra.persona@example.com',
      },
    ],
  });
  const result = await judgeImpact(baseParams({ runAdapter: async () => leaky }));
  assert.ok(!result.verdict.summary.includes('persona@example.com'));
  assert.ok(result.verdict.summary.includes('[REDACTED_EMAIL]'));
  assert.ok(result.verdict.affected[0].reason.includes('[REDACTED_EMAIL]'));
});

test('el prompt incluye diff, candidatos con evidencia y co-cambios (incl. noSignal)', () => {
  const prompt = buildJudgmentPrompt({
    candidates,
    coChanges,
    diffSummary: 'repo-a: src/api.js (2 hunks)',
  });
  assert.ok(prompt.includes('repo-a: src/api.js'));
  assert.ok(prompt.includes('repo-b/src/consumer.js'));
  assert.ok(prompt.includes('repo-c/src/client.js'));
  assert.ok(prompt.includes('count'));
  assert.ok(prompt.includes('sin historial'));
});

test('fallo del adapter: JudgmentError con causa', async () => {
  await assert.rejects(
    () =>
      judgeImpact(
        baseParams({
          runAdapter: async () => {
            throw new Error('ollama no responde');
          },
        }),
      ),
    (err) =>
      err instanceof JudgmentError &&
      /** @type {Error} */ (err.cause)?.message === 'ollama no responde',
  );
});
