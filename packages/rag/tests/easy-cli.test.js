// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseIndexArgs,
  createEasyDeps,
  runIndexCommand,
  parseQueryArgs,
  parseFingerprint,
  runQueryCommand,
  parseEvalArgs,
  runEvalCommand,
} from '../src/easy/cli.js';
import { fileURLToPath } from 'node:url';

test('parseIndexArgs: defaults ADR-005 (lancedb + hash)', () => {
  const opts = parseIndexArgs(['./docs']);
  assert.equal(opts.store, 'lancedb');
  assert.equal(opts.embedder, 'hash');
  assert.equal(opts.dimensions, 256);
  assert.ok(path.isAbsolute(opts.rootDir));
});

test('parseIndexArgs: flags explícitos y dimensions por embedder', () => {
  const opts = parseIndexArgs(['.', '--store', 'in-memory', '--embedder', 'transformers']);
  assert.equal(opts.store, 'in-memory');
  assert.equal(opts.dimensions, 384);
  const custom = parseIndexArgs(['.', '--dimensions', '128']);
  assert.equal(custom.dimensions, 128);
});

test('parseIndexArgs: valida ruta, store y embedder', () => {
  assert.throws(() => parseIndexArgs([]), /ruta/);
  assert.throws(() => parseIndexArgs(['.', '--store', 'redis']), /--store/);
  assert.throws(() => parseIndexArgs(['.', '--embedder', 'openai']), /--embedder/);
  assert.throws(() => parseIndexArgs(['.', '--dimensions', 'muchas']), /--dimensions/);
});

test('createEasyDeps: pgvector sin PG_URL falla con mensaje accionable', async () => {
  const options = parseIndexArgs(['.', '--store', 'pgvector']);
  await assert.rejects(() => createEasyDeps(options, {}), /PG_URL/);
});

test('createEasyDeps: in-memory construye store y embedder coherentes', async () => {
  const options = parseIndexArgs(['.', '--store', 'in-memory', '--dimensions', '32']);
  const { embedder, store } = await createEasyDeps(options, {});
  assert.equal(embedder.dimensions, 32);
  const [vector] = await embedder.embedBatch(['hola']);
  assert.equal(vector.length, 32);
  await store.upsert([{ id: 'x', vector, metadata: {} }]);
});

test('parseQueryArgs: defaults y flags', () => {
  const opts = parseQueryArgs(['¿cómo se factura?']);
  assert.equal(opts.store, 'lancedb');
  assert.equal(opts.topK, 5);
  assert.equal(opts.answer, false);
  assert.equal(opts.adapter, 'claude');
  assert.ok(path.isAbsolute(opts.rootDir));

  const full = parseQueryArgs(['q', './docs', '--top-k', '3', '--answer', '--adapter', 'ollama']);
  assert.equal(full.topK, 3);
  assert.equal(full.answer, true);
  assert.equal(full.adapter, 'ollama');
});

test('parseQueryArgs: valida pregunta, store y top-k', () => {
  assert.throws(() => parseQueryArgs([]), /pregunta/);
  assert.throws(() => parseQueryArgs(['q', '--store', 'in-memory']), /no persiste/);
  assert.throws(() => parseQueryArgs(['q', '--top-k', 'cero']), /--top-k/);
});

test('parseFingerprint: deriva embedder y dimensiones del manifest', () => {
  assert.deepEqual(parseFingerprint('hash|256|abc123'), { embedder: 'hash', dimensions: 256 });
  assert.deepEqual(parseFingerprint('transformers|384|x'), {
    embedder: 'transformers',
    dimensions: 384,
  });
  assert.throws(() => parseFingerprint('openai|64|x'), /fingerprint/);
  assert.throws(() => parseFingerprint('hash|muchas|x'), /fingerprint/);
});

test('runQueryCommand: sin índice falla indicando cómo crearlo', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-noindex-'));
  try {
    await assert.rejects(
      () => runQueryCommand(['pregunta', root], { env: {}, log: () => {}, out: () => {} }),
      /karajan-rag index/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('parseEvalArgs: defaults (corpus junto al golden) y flags', () => {
  const opts = parseEvalArgs(['examples/golden/golden.json']);
  assert.ok(opts.goldenPath.endsWith('golden.json'));
  assert.ok(opts.corpusDir.endsWith(path.join('examples', 'golden', 'corpus')));
  assert.deepEqual(opts.judges, []);
  assert.equal(opts.dimensions, 64);

  const full = parseEvalArgs(['g.json', './otro-corpus', '--judges', 'claude, ollama', '--dimensions', '32']);
  assert.ok(full.corpusDir.endsWith('otro-corpus'));
  assert.deepEqual(full.judges, ['claude', 'ollama']);
  assert.equal(full.dimensions, 32);

  assert.throws(() => parseEvalArgs([]), /golden\.json/);
  assert.throws(() => parseEvalArgs(['g.json', '--dimensions', 'dos']), /--dimensions/);
});

test('runEvalCommand: golden del repo pasa y reporta métricas', async () => {
  const lines = [];
  const report = await runEvalCommand(
    [path.join(REPO_ROOT, 'examples/golden/golden.json')],
    { out: (msg) => lines.push(msg) },
  );
  assert.equal(report.passed, true);
  assert.ok(lines.some((l) => l.includes('faithfulness')));
  assert.equal(lines.at(-1), 'eval: PASSED');
});

test('runEvalCommand: --judges usa el registry inyectado y reporta outliers', async () => {
  const judgeScores = { j1: 0.9, j2: 0.85, j3: 0.1 };
  const registry = {
    has: () => true,
    get: (name) => async () => ({ parsedOutput: { json: { score: judgeScores[name], rationale: 'x' } } }),
  };
  const lines = [];
  const report = await runEvalCommand(
    [path.join(REPO_ROOT, 'examples/golden/golden.json'), '--judges', 'j1,j2,j3'],
    { out: (msg) => lines.push(msg), judgeRegistry: registry },
  );
  assert.ok(report.judgeReports);
  const first = Object.values(report.judgeReports)[0];
  assert.deepEqual(first.outliers, ['j3']);
  assert.ok(lines.some((l) => l.includes('outliers=[j3]')));
});

test('runIndexCommand: end-to-end con in-memory sobre un proyecto temporal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cli-'));
  const logs = [];
  try {
    await writeFile(path.join(root, 'README.md'), '# Demo\nTexto.\n', 'utf8');
    const result = await runIndexCommand([root, '--store', 'in-memory'], {
      env: {},
      log: (msg) => logs.push(msg),
    });
    assert.equal(result.indexedFiles, 1);
    assert.ok(logs.some((l) => l.includes('efímero')));
    assert.ok(logs.some((l) => l.startsWith('hecho:')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
