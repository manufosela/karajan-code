// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RetrievalError, findImpactCandidates } from '../src/retrieval.js';

/** Chunk mínimo del parser de diffs (KJW-TSK-0004). */
const chunk = (overrides = {}) => ({
  repo: 'repo-a',
  path: 'src/api.js',
  oldPath: 'src/api.js',
  changeType: 'modified',
  newStart: 10,
  addedLines: [],
  removedLines: [],
  text: 'const TIMEOUT_MS = 5000;',
  ...overrides,
});

const hit = (source, score, line = 3) => ({
  id: `doc:${source}#0`,
  content: `contenido de ${source}`,
  source,
  line,
  score,
  sensitivity: 'internal',
  scores: { vector: score, bm25: score },
});

/** Query fake: devuelve los mismos hits para cualquier pregunta. */
const staticQuery = (hits) => async () => ({ hits, candidates: hits.length });

test('excluye hits del repo origen con frontera de segmento', async () => {
  const query = staticQuery([
    hit('repo-a/src/api.js', 0.9),
    hit('repo-a-extra/src/client.js', 0.8),
    hit('repo-b/src/consumer.js', 0.7),
  ]);
  const { candidates } = await findImpactCandidates({ chunks: [chunk()], query });
  assert.deepEqual(
    candidates.map((c) => c.source),
    ['repo-a-extra/src/client.js', 'repo-b/src/consumer.js'],
  );
  assert.equal(candidates[1].repo, 'repo-b');
});

test('dedupe por fichero destino: score máximo, evidencia acumulada', async () => {
  const chunks = [
    chunk({ path: 'src/api.js', newStart: 10 }),
    chunk({ path: 'src/model.js', newStart: 30, text: 'schema de usuario' }),
  ];
  let call = 0;
  const query = async () => {
    call += 1;
    return call === 1
      ? { hits: [hit('repo-b/src/consumer.js', 0.6, 5)], candidates: 10 }
      : { hits: [hit('repo-b/src/consumer.js', 0.9, 8)], candidates: 10 };
  };
  const { candidates } = await findImpactCandidates({ chunks, query });
  assert.equal(candidates.length, 1);
  const [candidate] = candidates;
  assert.equal(candidate.score, 0.9);
  assert.equal(candidate.evidence.length, 2);
  assert.deepEqual(
    candidate.evidence.map((e) => e.fromChunk.path),
    ['src/api.js', 'src/model.js'],
  );
  assert.deepEqual(candidate.evidence.map((e) => e.line), [5, 8]);
});

test('orden descendente por score y corte topK', async () => {
  const query = staticQuery([
    hit('repo-b/a.js', 0.2),
    hit('repo-b/b.js', 0.9),
    hit('repo-c/c.js', 0.5),
  ]);
  const { candidates } = await findImpactCandidates({ chunks: [chunk()], query, topK: 2 });
  assert.deepEqual(
    candidates.map((c) => c.source),
    ['repo-b/b.js', 'repo-c/c.js'],
  );
});

test('chunks sin texto (binarios, renames puros) no generan consultas', async () => {
  let calls = 0;
  const query = async () => {
    calls += 1;
    return { hits: [hit('repo-b/x.js', 0.5)], candidates: 4 };
  };
  await findImpactCandidates({
    chunks: [chunk({ changeType: 'binary', text: '' }), chunk()],
    query,
  });
  assert.equal(calls, 1);
});

test('corpus vacío (0 candidatos crudos en todas las queries) = RetrievalError', async () => {
  const query = staticQuery([]);
  await assert.rejects(
    () => findImpactCandidates({ chunks: [chunk()], query }),
    (err) => err instanceof RetrievalError && err.message.includes('corpus'),
  );
});

test('todos los hits del repo origen: lista vacía legítima, no error', async () => {
  const query = staticQuery([hit('repo-a/src/otro.js', 0.9)]);
  const { candidates } = await findImpactCandidates({ chunks: [chunk()], query });
  assert.deepEqual(candidates, []);
});

test('query fallida: RetrievalError con causa, nunca resultado parcial silencioso', async () => {
  const query = async () => {
    throw new Error('pgvector caído');
  };
  await assert.rejects(
    () => findImpactCandidates({ chunks: [chunk()], query }),
    (err) => err instanceof RetrievalError && /** @type {Error} */ (err.cause)?.message === 'pgvector caído',
  );
});

test('sin chunks consultables = RetrievalError', async () => {
  const query = staticQuery([hit('repo-b/x.js', 0.5)]);
  await assert.rejects(() => findImpactCandidates({ chunks: [], query }), RetrievalError);
  await assert.rejects(
    () => findImpactCandidates({ chunks: [chunk({ text: '' })], query }),
    RetrievalError,
  );
});

test('excludeRepo explícito gana al repo de los chunks', async () => {
  const query = staticQuery([hit('repo-b/x.js', 0.5), hit('repo-c/y.js', 0.4)]);
  const { candidates } = await findImpactCandidates({
    chunks: [chunk()],
    query,
    excludeRepo: 'repo-b',
  });
  assert.deepEqual(candidates.map((c) => c.source), ['repo-c/y.js']);
});
