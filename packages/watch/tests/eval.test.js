// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.js';
import { GoldenSetError, validateGoldenSet, evaluateRanking, runGoldenEval } from '../src/eval.js';

const config = () =>
  validateConfig({
    repos: [{ name: 'repo-a' }, { name: 'repo-b' }],
    corpus: {
      code: { store: 'in-memory', embedder: 'hash' },
      docs: { store: 'in-memory', embedder: 'hash' },
    },
  });

const DIFF = `diff --git a/src/api.js b/src/api.js
index 1111111..2222222 100644
--- a/src/api.js
+++ b/src/api.js
@@ -1,1 +1,1 @@
-const A = 1;
+const A = 2;
`;

const goldenSet = (overrides = {}) => ({
  thresholds: { precision: 0.5, recall: 0.5, k: 5 },
  cases: [
    {
      name: 'timeout del api',
      repoName: 'repo-a',
      diff: DIFF,
      expectedImpacted: ['repo-b/src/consumer.js'],
    },
  ],
  ...overrides,
});

const assertInvalid = (golden, expectedPath) => {
  assert.throws(
    () => validateGoldenSet(golden),
    (err) => err instanceof GoldenSetError && err.path === expectedPath,
    `esperaba GoldenSetError en "${expectedPath}"`,
  );
};

test('validateGoldenSet: estricto con paths exactos', () => {
  assert.equal(validateGoldenSet(goldenSet()).cases.length, 1);
  assertInvalid(null, '$');
  assertInvalid({ ...goldenSet(), extra: 1 }, '$.extra');
  assertInvalid(goldenSet({ cases: [] }), '$.cases');
  assertInvalid(goldenSet({ cases: [{ name: 'x' }] }), '$.cases[0].repoName');
  assertInvalid(
    goldenSet({ cases: [{ name: 'x', repoName: 'r', diff: DIFF, expectedImpacted: [] }] }),
    '$.cases[0].expectedImpacted',
  );
  assertInvalid(goldenSet({ thresholds: { precision: 1.5 } }), '$.thresholds.precision');
  assertInvalid(goldenSet({ thresholds: { k: 0 } }), '$.thresholds.k');
});

test('evaluateRanking: precision y recall @k', () => {
  const ranking = [
    { source: 'repo-b/src/consumer.js' },
    { source: 'repo-c/src/x.js' },
    { source: 'repo-b/src/other.js' },
  ];
  const m = evaluateRanking(ranking, ['repo-b/src/consumer.js', 'repo-b/src/missing.js'], 2);
  // top-2 devueltos, 1 acierto de 2 esperados.
  assert.equal(m.truePositives, 1);
  assert.equal(m.precision, 0.5);
  assert.equal(m.recall, 0.5);

  // k mayor que lo devuelto: precisión sobre lo realmente devuelto.
  const m2 = evaluateRanking([{ source: 'repo-b/src/consumer.js' }], ['repo-b/src/consumer.js'], 10);
  assert.equal(m2.precision, 1);
  assert.equal(m2.recall, 1);

  // Ranking vacío: cero, no NaN.
  const m3 = evaluateRanking([], ['repo-b/src/consumer.js'], 5);
  assert.equal(m3.precision, 0);
  assert.equal(m3.recall, 0);
});

test('runGoldenEval: señales puras (sin juicio, sin entrega) y gate agregado', async () => {
  let adapterCalled = false;
  let fetchCalled = false;
  const deps = {
    query: async () => ({
      hits: [
        { source: 'repo-b/src/consumer.js', line: 3, score: 0.9, content: 'x', sensitivity: 'internal' },
      ],
      candidates: 7,
    }),
    runAdapter: async () => {
      adapterCalled = true;
      return '{}';
    },
    fetchFn: async () => {
      fetchCalled = true;
      return { ok: true, status: 200 };
    },
  };
  const report = await runGoldenEval({
    golden: validateGoldenSet(goldenSet()),
    config: config(),
    workspaceDir: '/ws',
    deps,
  });
  assert.equal(adapterCalled, false);
  assert.equal(fetchCalled, false);
  assert.equal(report.cases[0].metrics.recall, 1);
  assert.equal(report.aggregate.precision, 1);
  assert.equal(report.passed, true);
});

test('runGoldenEval: agregado bajo el umbral = passed false', async () => {
  const deps = {
    query: async () => ({
      hits: [{ source: 'repo-b/src/irrelevante.js', line: 1, score: 0.9, content: 'x', sensitivity: 'internal' }],
      candidates: 7,
    }),
  };
  const report = await runGoldenEval({
    golden: validateGoldenSet(goldenSet()),
    config: config(),
    workspaceDir: '/ws',
    deps,
  });
  assert.equal(report.aggregate.recall, 0);
  assert.equal(report.passed, false);
});

test('runGoldenEval: caso con repo no declarado se propaga como error', async () => {
  const golden = validateGoldenSet(
    goldenSet({
      cases: [
        { name: 'x', repoName: 'repo-fantasma', diff: DIFF, expectedImpacted: ['repo-b/a.js'] },
      ],
    }),
  );
  await assert.rejects(
    () =>
      runGoldenEval({
        golden,
        config: config(),
        workspaceDir: '/ws',
        deps: { query: async () => ({ hits: [], candidates: 1 }) },
      }),
    /repo-fantasma/,
  );
});
