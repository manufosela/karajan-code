// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.js';
import { ImpactError, extractAdapterText, runImpactPipeline } from '../src/impact.js';

const config = () =>
  validateConfig({
    repos: [{ name: 'repo-a' }, { name: 'repo-b' }],
    corpus: {
      code: { store: 'in-memory', embedder: 'hash' },
      docs: { store: 'in-memory', embedder: 'hash' },
    },
    notify: { targets: [{ type: 'webhook', url: 'https://chat.example.com/hook' }] },
  });

const DIFF = `diff --git a/src/api.js b/src/api.js
index 1111111..2222222 100644
--- a/src/api.js
+++ b/src/api.js
@@ -1,2 +1,2 @@
-const TIMEOUT_MS = 1000;
+const TIMEOUT_MS = 5000;
`;

const VERDICT = JSON.stringify({
  summary: 'Afecta al consumidor.',
  affected: [
    { source: 'repo-b/src/consumer.js', severity: 'high', reason: 'usa el timeout' },
  ],
});

const fakeDeps = (overrides = {}) => ({
  query: async () => ({
    hits: [
      {
        source: 'repo-b/src/consumer.js',
        line: 4,
        score: 0.8,
        content: 'x',
        sensitivity: 'internal',
      },
    ],
    candidates: 12,
  }),
  runAdapter: async () => VERDICT,
  fetchFn: async () => ({ ok: true, status: 200 }),
  readHistory: async () => [
    { hash: 'h1', date: '2026-01-10T12:00:00Z', files: ['src/api.js'] },
  ],
  ...overrides,
});

const baseParams = (overrides = {}) => ({
  config: config(),
  workspaceDir: '/ws',
  repoName: 'repo-a',
  diffText: DIFF,
  deps: fakeDeps(),
  ...overrides,
});

test('happy path: orquesta las cinco piezas y entrega el informe', async () => {
  /** @type {string[]} */
  const delivered = [];
  const deps = fakeDeps({
    fetchFn: async (url, options) => {
      delivered.push(options.body);
      return { ok: true, status: 200 };
    },
  });
  const result = await runImpactPipeline(baseParams({ deps }));
  assert.equal(result.ranking[0].source, 'repo-b/src/consumer.js');
  assert.equal(result.ranking[0].judged?.severity, 'high');
  assert.ok(result.markdown.includes('repo-b/src/consumer.js'));
  assert.equal(result.delivered, 1);
  assert.ok(delivered[0].includes('karajan-watch'));
});

test('repo no declarado en el config: ImpactError con el nombre', async () => {
  await assert.rejects(
    () => runImpactPipeline(baseParams({ repoName: 'repo-fantasma' })),
    (err) => err instanceof ImpactError && err.message.includes('repo-fantasma'),
  );
});

test('deliver=false: informe sin entrega', async () => {
  let fetched = false;
  const deps = fakeDeps({
    fetchFn: async () => {
      fetched = true;
      return { ok: true, status: 200 };
    },
  });
  const result = await runImpactPipeline(baseParams({ deps, deliver: false }));
  assert.equal(result.delivered, 0);
  assert.equal(fetched, false);
  assert.ok(result.markdown.length > 0);
});

test('fallo de una señal (query) se propaga, nunca informe parcial', async () => {
  const deps = fakeDeps({
    query: async () => {
      throw new Error('store caído');
    },
  });
  await assert.rejects(() => runImpactPipeline(baseParams({ deps })), /store caído|Retrieval/);
});

test('co-cambios sin historial: el pipeline sigue y el informe refleja noSignal', async () => {
  const deps = fakeDeps({ readHistory: async () => [] });
  const result = await runImpactPipeline(baseParams({ deps }));
  assert.ok(result.coChanges.noSignal.length > 0);
});

test('la policy del config gobierna el adapter del juicio', async () => {
  /** @type {string[]} */
  const used = [];
  const customConfig = validateConfig({
    repos: [{ name: 'repo-a' }, { name: 'repo-b' }],
    corpus: {
      code: { store: 'in-memory', embedder: 'hash' },
      docs: { store: 'in-memory', embedder: 'hash' },
    },
    policy: {
      confidential: ['ollama'],
      internal: ['azure-openai'],
      public: ['claude'],
    },
  });
  const deps = fakeDeps({
    runAdapter: async (adapterName) => {
      used.push(adapterName);
      return VERDICT;
    },
  });
  await runImpactPipeline(baseParams({ config: customConfig, deps }));
  // corpus.code.sensitivity default = internal → primer permitido de la policy del config.
  assert.deepEqual(used, ['azure-openai']);
});

test('extractAdapterText: estricto, sin cadenas de fallback silenciosas', () => {
  assert.equal(extractAdapterText({ parsedOutput: { text: 'hola' } }), 'hola');
  assert.equal(extractAdapterText({ process: { stdout: 'salida' } }), 'salida');
  assert.throws(() => extractAdapterText({}), ImpactError);
  assert.throws(() => extractAdapterText(null), ImpactError);
  assert.throws(() => extractAdapterText({ parsedOutput: { text: '' } }), ImpactError);
});
