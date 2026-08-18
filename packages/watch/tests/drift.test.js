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

test('solo documentación: el código se filtra, la del propio repo NO', async () => {
  const result = await runDriftPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: DIFF,
    deps: fakeDeps(),
  });
  // `repo-a/docs/interno.md` es documentación del repo que cambió, y entra:
  // es el caso más común de deriva (KJW-TSK-0027). El consumidor de código
  // queda fuera porque esto es deriva de DOCS.
  assert.deepEqual(
    result.sections.map((s) => s.source),
    ['repo-b/docs/api.md', 'repo-a/docs/interno.md'],
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

// --- señal de contratos en la deriva (KJW-TSK-0021) -----------------------
//
// La similitud dice "este documento se parece a lo que cambiaste". El
// contrato dice "este documento nombra el endpoint que acabas de borrar", que
// no es parecido: es prueba de que el documento miente.

const CONTRACT_DIFF = `diff --git a/src/routes.js b/src/routes.js
index a1b2c3d..e4f5a6b 100644
--- a/src/routes.js
+++ b/src/routes.js
@@ -1,3 +1,3 @@
 export const mount = (app) => {
-  app.get('/api/v1/users/:id', getUser);
+  app.get('/api/v2/users/:id', getUser);
 };
`;

/**
 * Corpus donde el manual cita el endpoint literalmente pero el retrieval
 * semántico NO lo trae: solo la búsqueda literal puede encontrarlo.
 */
const contractDeps = (overrides = {}) => ({
  query: async (question) => {
    // El minero de contratos consulta el identificador EXACTO; el retrieval
    // semántico manda el texto del chunk entero.
    if (question.trim() === '/api/v1/users/:id') {
      return {
        hits: [
          {
            source: 'repo-b/docs/manual.md',
            line: 42,
            score: 0.05,
            content: 'Para consultar un usuario: GET /api/v1/users/:id',
            sensitivity: 'internal',
          },
          {
            source: 'repo-b/src/cliente.js',
            line: 7,
            score: 0.9,
            content: "fetch('/api/v1/users/:id')",
            sensitivity: 'internal',
          },
        ],
        candidates: 2,
      };
    }
    return { hits: [docHit('repo-b/docs/otro.md', 0.6)], candidates: 1 };
  },
  fetchFn: async () => ({ ok: true, status: 200 }),
  ...overrides,
});

test('un documento que cita el identificador entra aunque el retrieval no lo traiga', async () => {
  const result = await runDriftPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: CONTRACT_DIFF,
    deliver: false,
    deps: contractDeps(),
  });

  const manual = result.sections.find((s) => s.source === 'repo-b/docs/manual.md');
  assert.ok(manual, 'el documento que nombra el endpoint eliminado debe estar en el informe');
  assert.ok(manual.contract, 'debe llevar la evidencia de contrato');
  assert.equal(manual.contract.tokens[0].value, '/api/v1/users/:id');
  assert.equal(manual.contract.tokens[0].removed, true, 'el endpoint desapareció: es rotura');
});

test('la evidencia dura va por delante de la similitud', async () => {
  const result = await runDriftPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: CONTRACT_DIFF,
    deliver: false,
    deps: contractDeps(),
  });

  assert.equal(result.sections[0].source, 'repo-b/docs/manual.md');
  assert.ok(
    result.sections[0].score < result.sections[1].score,
    'ordena por evidencia, no por score: el contrato gana con score menor',
  );
});

test('el informe cita el identificador que quedó obsoleto', async () => {
  const result = await runDriftPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: CONTRACT_DIFF,
    deliver: false,
    deps: contractDeps(),
  });

  assert.match(result.markdown, /\/api\/v1\/users\/:id/);
  assert.match(result.markdown, /contrato/i);
  assert.match(result.markdown, /eliminado/i);
});

test('el código que comparte contrato no entra: esto es deriva de DOCS', async () => {
  const result = await runDriftPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: CONTRACT_DIFF,
    deliver: false,
    deps: contractDeps(),
  });

  assert.ok(
    !result.sections.some((s) => s.source === 'repo-b/src/cliente.js'),
    'un consumidor de código es cosa del pipeline de impacto, no de la deriva',
  );
});

test('la señal se puede apagar desde el config', async () => {
  const result = await runDriftPipeline({
    config: config({ contracts: { enabled: false } }),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: CONTRACT_DIFF,
    deliver: false,
    deps: contractDeps(),
  });

  assert.ok(!result.sections.some((s) => s.contract));
});

test('el juicio no puede tumbar una cita literal', async () => {
  const result = await runDriftPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: CONTRACT_DIFF,
    judge: true,
    deliver: false,
    deps: contractDeps({
      // El LLM solo ve interesante otro documento; el que cita el endpoint,
      // no. La evidencia dura no depende de que la opinión la respalde.
      runAdapter: async () => JSON.stringify({ affected: [], summary: 'nada relevante' }),
    }),
  });

  assert.ok(
    result.sections.some((s) => s.source === 'repo-b/docs/manual.md'),
    'una sección con contrato sobrevive al juicio aunque el LLM no la mencione',
  );
});

test('un documento que cita varios identificadores los conserva todos', async () => {
  const deps = contractDeps({
    query: async (question) => {
      // El mismo manual casa con dos identificadores distintos del diff: el
      // eliminado no puede perderse por culpa del otro.
      if (question.trim() === '/api/v1/users/:id' || question.trim() === '/api/v1/orders') {
        return {
          hits: [
            {
              source: 'repo-b/docs/manual.md',
              line: 42,
              score: 0.05,
              content: 'GET /api/v1/users/:id y POST /api/v1/orders',
              sensitivity: 'internal',
            },
          ],
          candidates: 1,
        };
      }
      // El retrieval semántico no trae ningún documento: todo lo que salga
      // en el informe habrá llegado por la cita literal.
      return { hits: [docHit('repo-b/src/nada.js', 0.4)], candidates: 5 };
    },
  });

  const result = await runDriftPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: `diff --git a/src/routes.js b/src/routes.js
index a1b2c3d..e4f5a6b 100644
--- a/src/routes.js
+++ b/src/routes.js
@@ -1,4 +1,4 @@
 export const mount = (app) => {
-  app.get('/api/v1/users/:id', getUser);
-  app.post('/api/v1/orders', createOrder);
+  app.get('/api/v2/users/:id', getUser);
+  app.post('/api/v2/orders', createOrder);
 };
`,
    deliver: false,
    deps,
  });

  const manual = result.sections.find((s) => s.source === 'repo-b/docs/manual.md');
  assert.ok(manual?.contract);
  assert.deepEqual(
    manual.contract.tokens.map((t) => t.value).sort(),
    ['/api/v1/orders', '/api/v1/users/:id'],
  );
  assert.match(result.markdown, /\/api\/v1\/orders/);
});

// --- la documentación del propio repo (KJW-TSK-0027) ----------------------
//
// El documento que primero queda mintiendo es el que vive AL LADO del código
// que cambió. Excluir el repo origen —correcto para el impacto cross-repo—
// lo escondía justo en el caso más común.

/** Corpus donde el manual desactualizado está en el MISMO repo del diff. */
const ownRepoDeps = (overrides = {}) => ({
  query: async (question) => {
    if (question.trim() === '/api/v1/users/:id') {
      return {
        hits: [
          {
            source: 'repo-a/README.md',
            line: 12,
            score: 0.04,
            content: 'Consulta un usuario con GET /api/v1/users/:id',
            sensitivity: 'internal',
          },
          {
            // El fichero que el propio diff acaba de tocar: no es
            // documentación desactualizada, es el cambio.
            source: 'repo-a/src/routes.js',
            line: 2,
            score: 0.95,
            content: "app.get('/api/v1/users/:id', getUser);",
            sensitivity: 'internal',
          },
        ],
        candidates: 2,
      };
    }
    return { hits: [docHit('repo-a/docs/tocado.md', 0.7)], candidates: 3 };
  },
  fetchFn: async () => ({ ok: true, status: 200 }),
  ...overrides,
});

test('el README del propio repo que cita el endpoint eliminado sí aparece', async () => {
  const result = await runDriftPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: CONTRACT_DIFF,
    deliver: false,
    deps: ownRepoDeps(),
  });

  const readme = result.sections.find((s) => s.source === 'repo-a/README.md');
  assert.ok(readme, 'la documentación del propio repo debe entrar en la deriva');
  assert.equal(readme.contract?.tokens[0].value, '/api/v1/users/:id');
  assert.equal(readme.contract?.tokens[0].removed, true);
});

test('los ficheros que el diff tocó no se listan a sí mismos', async () => {
  const result = await runDriftPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: CONTRACT_DIFF,
    deliver: false,
    deps: ownRepoDeps(),
  });

  assert.ok(
    !result.sections.some((s) => s.source === 'repo-a/src/routes.js'),
    'el fichero del propio diff no es documentación que haya quedado obsoleta',
  );
});

test('el impacto cross-repo sigue excluyendo el repo origen', async () => {
  // No regresión: la exclusión que se relaja en la deriva es CORRECTA aquí.
  const { runImpactPipeline } = await import('../src/impact.js');
  const result = await runImpactPipeline({
    config: config(),
    workspaceDir: '/ws',
    repoName: 'repo-a',
    diffText: CONTRACT_DIFF,
    judge: false,
    deliver: false,
    deps: ownRepoDeps({ readHistory: async () => [] }),
  });

  assert.ok(
    !result.ranking.some((e) => e.source.startsWith('repo-a/')),
    'el impacto mira a los OTROS repos: el origen no debe aparecer',
  );
});
