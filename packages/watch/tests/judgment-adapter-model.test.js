// @ts-check
// KJW-TSK-0040: el operador elige adapter y modelo del juez desde el binario
// (sin scripts propios), y la guardia distingue «formato saltado» (la fuente
// devuelta se corresponde con una señal conocida escrita de otra forma) de
// «inventado» (no aparece por ningún lado). En ambos casos se descarta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.js';
import { createDefaultRunAdapter, runImpactPipeline } from '../src/impact.js';
import { judgeImpact } from '../src/judgment.js';

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
  '@@ -1,2 +1,2 @@',
  '-const TIMEOUT_MS = 1000;',
  '+const TIMEOUT_MS = 5000;',
  '',
].join('\n');

const VERDICT = JSON.stringify({ summary: 'ok', affected: [] });

test('el adapter elegido llega al juez a través del pipeline (--adapter)', async () => {
  let captured = null;
  const result = await runImpactPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: DIFF,
    adapter: 'vertex-ai',
    deps: {
      query: async () => ({
        hits: [{ source: 'repo-b/src/x.js', line: 1, score: 0.8, content: 'x', sensitivity: 'internal' }],
        candidates: 1,
      }),
      runAdapter: async (name) => {
        captured = name;
        return VERDICT;
      },
      readHistory: async () => [],
    },
  });
  assert.ok(result);
  assert.equal(captured, 'vertex-ai');
});

test('createDefaultRunAdapter({model}) pasa el modelo como opción del adapter', async () => {
  let seen = null;
  const registryFactory = async () => ({
    get: () => async (prompt, options) => {
      seen = options;
      return { parsedOutput: { text: VERDICT } };
    },
  });
  const run = createDefaultRunAdapter({ model: 'gemini-2.5-pro', registryFactory });
  await run('vertex-ai', 'hola');
  assert.deepEqual(seen, { model: 'gemini-2.5-pro' });
});

test('la guardia clasifica el descarte: formato saltado vs inventado', async () => {
  const result = await judgeImpact({
    candidates: [
      {
        source: 'hoop-api/openapi/openapi.json',
        repo: 'hoop-api',
        score: 0.7,
        evidence: [{ fromChunk: { path: 'src/api.php', newStart: 1 }, line: 2, score: 0.7 }],
      },
    ],
    coChanges: { byRepo: [], noSignal: [] },
    diffSummary: 'x',
    sensitivity: 'public',
    policy: { confidential: ['ollama'], internal: ['ollama'], public: ['claude'] },
    runAdapter: async () =>
      JSON.stringify({
        summary: 'ok',
        affected: [
          { source: 'hoop-api: openapi/openapi.json', severity: 'low', reason: 'formato con dos puntos' },
          { source: 'zzz/inventado.js', severity: 'low', reason: 'no existe' },
        ],
      }),
  });
  assert.equal(result.verdict.affected.length, 0);
  assert.equal(result.discardedEntries, 2);
  const kinds = Object.fromEntries(result.discarded.map((d) => [d.source, d.kind]));
  assert.equal(kinds['hoop-api: openapi/openapi.json'], 'format');
  assert.equal(kinds['zzz/inventado.js'], 'unknown');
});
