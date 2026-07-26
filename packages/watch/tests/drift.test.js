// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.js';
import { DOC_EXTENSIONS, runDriftPipeline } from '../src/drift.js';

const config = (extra = {}) =>
  validateConfig({
    repos: [{ name: 'repo-a' }, { name: 'repo-b' }],
    corpus: {
      code: { store: 'in-memory', embedder: 'hash' },
      docs: { store: 'in-memory', embedder: 'hash' },
    },
    ...extra,
  });

const DIFF = `diff --git a/src/api.js b/src/api.js
index 1111111..2222222 100644
--- a/src/api.js
+++ b/src/api.js
@@ -1,2 +1,2 @@
-const TIMEOUT_MS = 1000;
+const TIMEOUT_MS = 5000;
`;

const docHit = (source, score, line = 12) => ({
  source,
  line,
  score,
  content: 'x',
  sensitivity: 'internal',
});

const fakeDeps = (overrides = {}) => ({
  query: async () => ({
    hits: [
      docHit('repo-b/docs/api.md', 0.8),
      docHit('repo-b/src/consumer.js', 0.9),
      docHit('repo-a/docs/interno.md', 0.7),
    ],
    candidates: 9,
  }),
  fetchFn: async () => ({ ok: true, status: 200 }),
  ...overrides,
});

test('solo documentación de otros repos: código y repo origen filtrados', async () => {
  const result = await runDriftPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: DIFF,
    deps: fakeDeps(),
  });
  assert.deepEqual(
    result.sections.map((s) => s.source),
    ['repo-b/docs/api.md'],
  );
  assert.ok(result.markdown.includes('repo-b/docs/api.md'));
  assert.ok(result.markdown.includes(':12'));
});

test('DOC_EXTENSIONS cubre los formatos habituales', () => {
  for (const ext of ['.md', '.mdx', '.rst', '.txt']) {
    assert.ok(DOC_EXTENSIONS.includes(ext), ext);
  }
});

test('cero deriva: informe explícito, nunca silencio', async () => {
  const deps = fakeDeps({
    query: async () => ({ hits: [docHit('repo-b/src/only-code.js', 0.9)], candidates: 5 }),
  });
  const result = await runDriftPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: DIFF,
    deps,
  });
  assert.deepEqual(result.sections, []);
  assert.ok(/sin (secciones|deriva)/i.test(result.markdown));
});

test('judge desactivado por defecto: no se llama a ningún adapter', async () => {
  let judged = false;
  const deps = fakeDeps({
    runAdapter: async () => {
      judged = true;
      return '{}';
    },
  });
  await runDriftPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: DIFF,
    deps,
  });
  assert.equal(judged, false);
});

test('judge activado: filtra con el veredicto y usa la policy del config', async () => {
  /** @type {string[]} */
  const used = [];
  const verdict = JSON.stringify({
    summary: 'Solo api.md queda desactualizado.',
    affected: [{ source: 'repo-b/docs/api.md', severity: 'medium', reason: 'menciona el timeout' }],
  });
  const deps = fakeDeps({
    query: async () => ({
      hits: [docHit('repo-b/docs/api.md', 0.8), docHit('repo-b/docs/faq.md', 0.6)],
      candidates: 9,
    }),
    runAdapter: async (adapterName) => {
      used.push(adapterName);
      return verdict;
    },
  });
  const result = await runDriftPipeline({
    config: config({
      policy: { confidential: ['ollama'], internal: ['azure-openai'], public: ['claude'] },
    }),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: DIFF,
    judge: true,
    deps,
  });
  assert.deepEqual(used, ['azure-openai']);
  assert.deepEqual(result.sections.map((s) => s.source), ['repo-b/docs/api.md']);
  assert.equal(result.sections[0].judged?.severity, 'medium');
});

test('entrega reutilizada: notify.targets del config', async () => {
  /** @type {string[]} */
  const posts = [];
  const deps = fakeDeps({
    fetchFn: async (url) => {
      posts.push(url);
      return { ok: true, status: 200 };
    },
  });
  const result = await runDriftPipeline({
    config: config({ notify: { targets: [{ type: 'webhook', url: 'https://chat.example.com/h' }] } }),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: DIFF,
    deps,
  });
  assert.equal(result.delivered, 1);
  assert.deepEqual(posts, ['https://chat.example.com/h']);
});

test('fallo de query se propaga', async () => {
  const deps = fakeDeps({
    query: async () => {
      throw new Error('docs store caído');
    },
  });
  await assert.rejects(
    () =>
      runDriftPipeline({
        config: config(),
        workspaceDir: '/ws',
        repoName: 'repo-a',
        diffText: DIFF,
        deps,
      }),
    /docs store caído|Retrieval/,
  );
});
