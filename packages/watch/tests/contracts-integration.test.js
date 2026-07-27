// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, validateConfig } from '../src/config.js';
import { buildImpactRanking, renderImpactMarkdown } from '../src/report.js';
import { buildJudgmentPrompt } from '../src/judgment.js';
import { runImpactPipeline } from '../src/impact.js';

const baseConfig = (extra = {}) =>
  validateConfig({
    repos: [{ name: 'repo-a' }, { name: 'repo-b' }],
    corpus: {
      code: { store: 'in-memory', embedder: 'hash' },
      docs: { store: 'in-memory', embedder: 'hash' },
    },
    ...extra,
  });

const DIFF = `diff --git a/src/routes.js b/src/routes.js
index 1111111..2222222 100644
--- a/src/routes.js
+++ b/src/routes.js
@@ -10,2 +10,2 @@ export const mount = (app) => {
-  app.get('/api/v1/users/:id', getUser);
+  app.get('/api/v2/users/:id', getUser);
`;

const contractMatch = (source, value = '/api/v1/users/:id', removed = true) => ({
  source,
  repo: source.split('/')[0],
  line: 42,
  tokens: [{ value, type: 'http', removed, fromChunk: { path: 'src/routes.js', newStart: 10 } }],
});

test('config: sección contracts opcional y validada con path exacto', () => {
  const ok = baseConfig({ contracts: { enabled: true, types: ['http', 'sql'] } });
  assert.deepEqual(ok.contracts.types, ['http', 'sql']);
  assert.equal(baseConfig().contracts, undefined);

  const invalid = (contracts, path) =>
    assert.throws(
      () => validateConfig({ ...baseConfig(), contracts }),
      (err) => err instanceof ConfigError && err.path === path,
      `esperaba ConfigError en ${path}`,
    );
  invalid({ types: ['grpc'] }, '$.contracts.types');
  invalid({ types: [] }, '$.contracts.types');
  invalid({ enabled: 'sí' }, '$.contracts.enabled');
  invalid({ extra: 1 }, '$.contracts.extra');
});

test('ranking: un contrato entra aunque no fuera candidato por similitud', () => {
  const ranking = buildImpactRanking({
    candidates: [],
    coChanges: { byRepo: [], noSignal: [] },
    verdict: { summary: '', affected: [] },
    contracts: [contractMatch('repo-b/src/api-client.js')],
  });
  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].source, 'repo-b/src/api-client.js');
  assert.equal(ranking[0].score, 0, 'no venía del retrieval');
  assert.equal(ranking[0].contract.tokens[0].value, '/api/v1/users/:id');
});

test('ranking: el contrato manda sobre la similitud y sobre el juicio', () => {
  const ranking = buildImpactRanking({
    candidates: [
      { source: 'repo-c/src/similar.js', repo: 'repo-c', score: 0.95, evidence: [] },
      { source: 'repo-b/src/api-client.js', repo: 'repo-b', score: 0.1, evidence: [] },
    ],
    coChanges: { byRepo: [], noSignal: [] },
    verdict: {
      summary: '',
      affected: [{ source: 'repo-c/src/similar.js', severity: 'high', reason: 'se parece' }],
    },
    contracts: [contractMatch('repo-b/src/api-client.js')],
  });
  assert.equal(ranking[0].source, 'repo-b/src/api-client.js', 'la evidencia dura va primero');
  assert.equal(ranking[1].source, 'repo-c/src/similar.js');
});

test('ranking: un contrato ROTO va por delante de uno que sigue vigente', () => {
  const ranking = buildImpactRanking({
    candidates: [],
    coChanges: { byRepo: [], noSignal: [] },
    verdict: { summary: '', affected: [] },
    contracts: [
      contractMatch('repo-b/vigente.js', '/api/v2/users/:id', false),
      contractMatch('repo-b/roto.js', '/api/v1/users/:id', true),
    ],
  });
  assert.deepEqual(ranking.map((e) => e.source), ['repo-b/roto.js', 'repo-b/vigente.js']);
});

test('informe: muestra el identificador y su tipo como evidencia', () => {
  const ranking = buildImpactRanking({
    candidates: [],
    coChanges: { byRepo: [], noSignal: [] },
    verdict: { summary: '', affected: [] },
    contracts: [contractMatch('repo-b/src/api-client.js')],
  });
  const md = renderImpactMarkdown({ ranking, diffSummary: 'repo-a: src/routes.js' });
  assert.ok(md.includes('/api/v1/users/:id'));
  assert.ok(/contrato/i.test(md));
  assert.ok(/http/i.test(md));
});

test('prompt del juicio: incluye los contratos hallados', () => {
  const prompt = buildJudgmentPrompt({
    candidates: [],
    coChanges: { byRepo: [], noSignal: [] },
    diffSummary: 'repo-a: src/routes.js',
    contracts: [contractMatch('repo-b/src/api-client.js')],
  });
  assert.ok(prompt.includes('/api/v1/users/:id'));
  assert.ok(/contract/i.test(prompt));
});

test('pipeline: la señal se ejecuta y aparece en el resultado', async () => {
  /** @type {string[]} */
  const asked = [];
  const deps = {
    query: async (question) => {
      asked.push(question);
      return {
        candidates: 6,
        hits: [
          {
            source: 'repo-b/src/api-client.js',
            line: 42,
            score: 0.3,
            content: "fetch('/api/v1/users/:id')",
            sensitivity: 'internal',
          },
        ],
      };
    },
    runAdapter: async () =>
      JSON.stringify({ summary: 'ok', affected: [] }),
    readHistory: async () => [],
    fetchFn: async () => ({ ok: true, status: 200 }),
  };
  const result = await runImpactPipeline({
    config: baseConfig(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: DIFF,
    deliver: false,
    deps,
  });
  assert.ok(result.contracts.length > 0, 'la señal produjo coincidencias');
  assert.ok(
    asked.some((q) => q.includes('/api/v1/users/:id')),
    'se consultó el corpus por el identificador de contrato',
  );
  assert.equal(result.ranking[0].source, 'repo-b/src/api-client.js');
});

test('pipeline: contracts.enabled=false desactiva la señal', async () => {
  /** @type {string[]} */
  const asked = [];
  const deps = {
    query: async (question) => {
      asked.push(question);
      return { candidates: 4, hits: [{ source: 'repo-b/x.js', line: 1, score: 0.5, content: 'x', sensitivity: 'internal' }] };
    },
    runAdapter: async () => JSON.stringify({ summary: 'ok', affected: [] }),
    readHistory: async () => [],
  };
  const result = await runImpactPipeline({
    config: baseConfig({ contracts: { enabled: false } }),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: DIFF,
    deliver: false,
    deps,
  });
  assert.deepEqual(result.contracts, []);
  assert.ok(
    !asked.some((q) => q === '/api/v1/users/:id'),
    'no se consultó por identificadores de contrato',
  );
});
