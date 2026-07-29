// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from '../src/config.js';
import { IngestError, buildIngestPlan, verifyWorkspace, runIngest } from '../src/ingest.js';

const baseConfig = () =>
  validateConfig({
    repos: [
      { name: 'repo-a', sensitivity: 'confidential' },
      { name: 'repo-b' },
    ],
    corpus: {
      code: { store: 'pgvector', embedder: 'transformers' },
      docs: { store: 'lancedb', embedder: 'hash', sensitivity: 'public' },
    },
  });

/** Crea un workspace temporal con un subdirectorio por repo indicado. */
const makeWorkspace = async (repoNames) => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-ws-'));
  for (const name of repoNames) {
    await mkdir(join(dir, name));
  }
  return dir;
};

test('buildIngestPlan: argv de karajan-rag index según el corpus', () => {
  const { args } = buildIngestPlan(baseConfig(), 'code', '/ws');
  assert.deepEqual(args, ['index', '/ws', '--store', 'pgvector', '--embedder', 'transformers']);

  const docs = buildIngestPlan(baseConfig(), 'docs', '/ws');
  assert.deepEqual(docs.args, ['index', '/ws', '--store', 'lancedb', '--embedder', 'hash']);
});

test('buildIngestPlan: easy config estampa sensibilidad global y por repo', () => {
  const { easyConfig } = buildIngestPlan(baseConfig(), 'code', '/ws');
  assert.equal(easyConfig.easy.store, 'pgvector');
  assert.equal(easyConfig.easy.embedder, 'transformers');
  assert.equal(easyConfig.easy.sensitivity, 'internal');
  assert.deepEqual(easyConfig.easy.sensitivityRules, [
    { prefix: 'repo-a/', level: 'confidential' },
    { prefix: 'repo-b/', level: 'internal' },
  ]);
});

test('buildIngestPlan: corpus desconocido = IngestError', () => {
  assert.throws(
    () => buildIngestPlan(baseConfig(), 'wiki', '/ws'),
    (err) => err instanceof IngestError && err.message.includes('wiki'),
  );
});

test('verifyWorkspace: repo declarado sin directorio = error con el nombre', async () => {
  const dir = await makeWorkspace(['repo-a']);
  await assert.rejects(
    () => verifyWorkspace(baseConfig(), dir),
    (err) => err instanceof IngestError && err.message.includes('repo-b'),
  );
});

test('verifyWorkspace: entrada no declarada en el config = error con el nombre', async () => {
  const dir = await makeWorkspace(['repo-a', 'repo-b', 'intruso']);
  await assert.rejects(
    () => verifyWorkspace(baseConfig(), dir),
    (err) => err instanceof IngestError && err.message.includes('intruso'),
  );
});

test('verifyWorkspace: .karajan y karajan.config.json permitidos, otros dotdirs no', async () => {
  const dir = await makeWorkspace(['repo-a', 'repo-b', '.karajan']);
  await writeFile(join(dir, 'karajan.config.json'), '{}', 'utf8');
  await assert.doesNotReject(() => verifyWorkspace(baseConfig(), dir));

  const dirty = await makeWorkspace(['repo-a', 'repo-b', '.git']);
  await assert.rejects(
    () => verifyWorkspace(baseConfig(), dirty),
    (err) => err instanceof IngestError && err.message.includes('.git'),
  );
});

test('runIngest: escribe karajan.config.json y ejecuta karajan-rag', async () => {
  const dir = await makeWorkspace(['repo-a', 'repo-b']);
  /** @type {{cmd: string, args: string[]}[]} */
  const calls = [];
  const result = await runIngest({
    config: baseConfig(),
    corpusName: 'code',
    workspaceDir: dir,
    env: { PG_URL: 'postgres://x' },
    exec: async (cmd, args) => {
      calls.push({ cmd, args });
      return 0;
    },
    log: () => {},
  });
  assert.equal(result.corpusName, 'code');
  assert.equal(calls.length, 1);
  // El binario de karajan-rag es de una DEPENDENCIA: se resuelve desde el
  // paquete y se lanza con el node en curso, nunca confiando en el PATH
  // (KJW-BUG-0003: `spawn('karajan-rag')` fallaba con ENOENT en cualquier
  // instalación que no lo tuviera global).
  assert.equal(calls[0].cmd, process.execPath);
  const [binPath, ...rest] = calls[0].args;
  assert.match(binPath, /karajan-rag[/\\]bin[/\\]karajan-rag\.js$/);
  assert.ok(existsSync(binPath), 'el binario resuelto existe en disco');
  assert.deepEqual(rest, [
    'index', dir, '--store', 'pgvector', '--embedder', 'transformers',
  ]);
  const written = JSON.parse(await readFile(join(dir, 'karajan.config.json'), 'utf8'));
  assert.equal(written.easy.sensitivity, 'internal');
  assert.equal(written.easy.sensitivityRules.length, 2);
});

test('runIngest: exit code != 0 = IngestError, nunca éxito degradado', async () => {
  const dir = await makeWorkspace(['repo-a', 'repo-b']);
  await assert.rejects(
    () =>
      runIngest({
        config: baseConfig(),
        corpusName: 'code',
        workspaceDir: dir,
        env: { PG_URL: 'postgres://x' },
        exec: async () => 3,
        log: () => {},
      }),
    (err) => err instanceof IngestError && err.message.includes('3'),
  );
});

test('runIngest: pgvector sin PG_URL/DATABASE_URL = error antes de ejecutar', async () => {
  const dir = await makeWorkspace(['repo-a', 'repo-b']);
  let executed = false;
  await assert.rejects(
    () =>
      runIngest({
        config: baseConfig(),
        corpusName: 'code',
        workspaceDir: dir,
        env: {},
        exec: async () => {
          executed = true;
          return 0;
        },
        log: () => {},
      }),
    (err) => err instanceof IngestError && err.message.includes('PG_URL'),
  );
  assert.equal(executed, false);
});

test('runIngest: workspace inválido = error antes de ejecutar', async () => {
  const dir = await makeWorkspace(['repo-a']);
  let executed = false;
  await assert.rejects(
    () =>
      runIngest({
        config: baseConfig(),
        corpusName: 'code',
        workspaceDir: dir,
        env: { PG_URL: 'postgres://x' },
        exec: async () => {
          executed = true;
          return 0;
        },
        log: () => {},
      }),
    (err) => err instanceof IngestError,
  );
  assert.equal(executed, false);
});

test('runIngest: sobrescribe un karajan.config.json previo avisando', async () => {
  const dir = await makeWorkspace(['repo-a', 'repo-b']);
  await writeFile(join(dir, 'karajan.config.json'), '{"easy":{"store":"lancedb"}}', 'utf8');
  /** @type {string[]} */
  const logged = [];
  await runIngest({
    config: baseConfig(),
    corpusName: 'code',
    workspaceDir: dir,
    env: { PG_URL: 'postgres://x' },
    exec: async () => 0,
    log: (msg) => logged.push(msg),
  });
  const written = JSON.parse(await readFile(join(dir, 'karajan.config.json'), 'utf8'));
  assert.equal(written.easy.store, 'pgvector');
  assert.ok(logged.some((m) => m.includes('karajan.config.json')));
});
