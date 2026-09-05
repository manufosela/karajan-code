// @ts-check
// KJW-TSK-0042: el eval honesto con el tiempo. Caso real de campo: el juez
// acertó a nivel repo (2/2, confirmado por merges posteriores) y la métrica
// de fichero daba 0 — porque los ficheros correctos se crearon DESPUÉS de
// indexar el corpus. Un número que castiga eso es engañoso: el caso declara
// cuándo fue el merge, el eval avisa si el índice es anterior, y existe
// métrica a nivel repo además de la de fichero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGoldenSet, runGoldenEval, evaluateRepoRanking, GoldenSetError } from '../src/eval.js';
import { validateConfig } from '../src/config.js';

const config = () =>
  validateConfig({
    repos: [{ name: 'repo-a' }, { name: 'repo-b' }],
    corpus: {
      code: { store: 'in-memory', embedder: 'hash' },
      docs: { store: 'in-memory', embedder: 'hash' },
    },
  });

const DIFF = [
  'diff --git a/src/api.js b/src/api.js',
  'index 1111111..2222222 100644',
  '--- a/src/api.js',
  '+++ b/src/api.js',
  '@@ -1,1 +1,1 @@',
  '-const A = 1;',
  '+const A = 2;',
  '',
].join('\n');

const golden = (caseOverrides = {}) => ({
  thresholds: { k: 5 },
  cases: [
    {
      name: 'invitaciones',
      repoName: 'repo-a',
      diff: DIFF,
      expectedImpacted: ['repo-b/src/consumer.js'],
      ...caseOverrides,
    },
  ],
});

const deps = () => ({
  query: async () => ({
    hits: [{ source: 'repo-b/src/consumer.js', line: 3, score: 0.9, content: 'x', sensitivity: 'internal' }],
    candidates: 7,
  }),
});

test('el caso declara mergedAt y expectedRepos; lo inválido se rechaza con path', () => {
  const ok = validateGoldenSet(
    golden({ mergedAt: '2026-08-31T10:00:00Z', expectedRepos: ['repo-b'] }),
  );
  assert.equal(ok.cases[0].mergedAt, '2026-08-31T10:00:00Z');
  assert.deepEqual(ok.cases[0].expectedRepos, ['repo-b']);
  assert.throws(
    () => validateGoldenSet(golden({ mergedAt: 'ayer' })),
    (err) => err instanceof GoldenSetError && err.path === '$.cases[0].mergedAt',
  );
  assert.throws(
    () => validateGoldenSet(golden({ expectedRepos: [] })),
    (err) => err instanceof GoldenSetError && err.path === '$.cases[0].expectedRepos',
  );
});

test('evaluateRepoRanking: acierto por repo aunque el fichero exacto no exista en el corpus', () => {
  const ranking = [
    { source: 'new-app-android/src/sso/Auth.kt', repo: 'new-app-android' },
    { source: 'repo-c/x.js', repo: 'repo-c' },
  ];
  const m = evaluateRepoRanking(ranking, ['new-app-android', 'new-app-ios'], 5);
  assert.equal(m.truePositives, 1);
  assert.equal(m.precision, 0.5);
  assert.equal(m.recall, 0.5);
});

test('métrica de repo en el informe cuando el caso declara expectedRepos', async () => {
  const report = await runGoldenEval({
    golden: validateGoldenSet(golden({ expectedRepos: ['repo-b'] })),
    config: config(),
    workspaceDir: '/ws',
    deps: deps(),
  });
  assert.equal(report.cases[0].repoMetrics?.recall, 1);
  assert.equal(report.aggregate.repoRecall, 1);
});

test('índice anterior al merge = AVISO explícito, nunca un número en silencio', async () => {
  const report = await runGoldenEval({
    golden: validateGoldenSet(golden({ mergedAt: '2026-08-31T10:00:00Z' })),
    config: config(),
    workspaceDir: '/ws',
    corpusIndexedAt: '2026-08-21T00:00:00Z',
    deps: deps(),
  });
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /invitaciones/);
  assert.match(report.warnings[0], /anterior al merge/i);
  assert.equal(report.measuredWith.corpusIndexedAt, '2026-08-21T00:00:00Z');
});

test('sin fechas o con índice fresco no hay aviso', async () => {
  const fresh = await runGoldenEval({
    golden: validateGoldenSet(golden({ mergedAt: '2026-08-01T10:00:00Z' })),
    config: config(),
    workspaceDir: '/ws',
    corpusIndexedAt: '2026-08-21T00:00:00Z',
    deps: deps(),
  });
  assert.equal(fresh.warnings.length, 0);
  const undated = await runGoldenEval({
    golden: validateGoldenSet(golden()),
    config: config(),
    workspaceDir: '/ws',
    deps: deps(),
  });
  assert.equal(undated.warnings.length, 0);
});
