// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.js';
import { runImpactPipeline } from '../src/impact.js';
import { runDriftPipeline } from '../src/drift.js';

const config = validateConfig({
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

/** Rag falso que anota si le cerraron la conexión. */
const fakeRag = () => {
  const state = { closed: 0 };
  return {
    state,
    create: async () => ({
      query: async () => ({ hits: [], candidates: 3 }),
      close: async () => {
        state.closed += 1;
      },
    }),
  };
};

const shared = {
  config,
  workspaceDir: '/ws',
  repoName: 'repo-a',
  diffText: DIFF,
  deliver: false,
  judge: false,
};

test('impact cierra el rag que él mismo abrió', async () => {
  // KJW-BUG-0007: sin esto el proceso queda vivo con la conexión abierta.
  const rag = fakeRag();
  await runImpactPipeline({
    ...shared,
    deps: { createRag: rag.create, readHistory: async () => [] },
  });
  assert.equal(rag.state.closed, 1);
});

test('impact lo cierra también si el pipeline falla después de abrirlo', async () => {
  // El fallo debe ocurrir con el recurso ya abierto: el store revienta al
  // consultar, que es el caso real (conexión caída a mitad de pipeline).
  const state = { closed: 0 };
  const create = async () => ({
    query: async () => {
      throw new Error('store caído');
    },
    close: async () => {
      state.closed += 1;
    },
  });
  await assert.rejects(
    () => runImpactPipeline({ ...shared, deps: { createRag: create, readHistory: async () => [] } }),
    /store caído|Retrieval/,
  );
  assert.equal(state.closed, 1, 'el recurso se libera aunque haya error');
});

test('impact NO cierra un query inyectado: no es suyo', async () => {
  const rag = fakeRag();
  await runImpactPipeline({
    ...shared,
    deps: {
      createRag: rag.create,
      query: async () => ({ hits: [], candidates: 1 }),
      readHistory: async () => [],
    },
  });
  assert.equal(rag.state.closed, 0);
});

test('drift también cierra el suyo', async () => {
  const rag = fakeRag();
  await runDriftPipeline({ ...shared, deps: { createRag: rag.create } });
  assert.equal(rag.state.closed, 1);
});
