// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CoChangeError, correlateCoChanges, readRepoHistory } from '../src/cochanges.js';

const run = promisify(execFile);

/** Commit sintético. */
const commit = (hash, date, files) => ({ hash, date, files });

const HOUR = 60 * 60 * 1000;
const t0 = Date.parse('2026-01-10T12:00:00Z');
const iso = (offsetHours) => new Date(t0 + offsetHours * HOUR).toISOString();

const origin = {
  name: 'repo-a',
  commits: [
    commit('a1', iso(0), ['src/api.js', 'src/model.js']),
    commit('a2', iso(-24 * 30), ['src/api.js']),
    commit('a3', iso(-24 * 60), ['README.md']),
  ],
};

test('correlación básica: co-cambios dentro de la ventana, contados y ordenados', () => {
  const targets = [
    {
      name: 'repo-b',
      commits: [
        commit('b1', iso(1), ['src/consumer.js']),
        commit('b2', iso(-24 * 30 + 2), ['src/consumer.js', 'src/other.js']),
        commit('b3', iso(-24 * 90), ['src/consumer.js']),
      ],
    },
  ];
  const result = correlateCoChanges({
    origin,
    targets,
    touchedPaths: ['src/api.js'],
    windowHours: 48,
  });
  assert.equal(result.byRepo.length, 1);
  const [repoB] = result.byRepo;
  assert.equal(repoB.repo, 'repo-b');
  // consumer.js co-cambió con a1 (b1) y con a2 (b2): count 2. other.js solo con a2: count 1.
  assert.deepEqual(
    repoB.coChanges.map((c) => ({ path: c.path, count: c.count })),
    [
      { path: 'src/consumer.js', count: 2 },
      { path: 'src/other.js', count: 1 },
    ],
  );
  assert.equal(repoB.coChanges[0].lastDate, iso(1));
});

test('burst de commits en la misma ventana: el path cuenta una sola vez', () => {
  const targets = [
    {
      name: 'repo-b',
      commits: [
        commit('b1', iso(1), ['src/consumer.js']),
        commit('b2', iso(2), ['src/consumer.js']),
        commit('b3', iso(3), ['src/consumer.js']),
      ],
    },
  ];
  const result = correlateCoChanges({
    origin,
    targets,
    touchedPaths: ['src/api.js'],
    windowHours: 48,
  });
  const [entry] = result.byRepo[0].coChanges;
  assert.equal(entry.count, 1);
  assert.equal(entry.lastDate, iso(3));
});

test('ventana estrecha: commits lejanos no cuentan', () => {
  const targets = [
    { name: 'repo-b', commits: [commit('b1', iso(30), ['src/consumer.js'])] },
  ];
  const result = correlateCoChanges({
    origin,
    targets,
    touchedPaths: ['src/api.js'],
    windowHours: 12,
  });
  assert.deepEqual(result.byRepo[0].coChanges, []);
  assert.deepEqual(result.noSignal, []);
});

test('repo sin commits: noSignal explícito con motivo, nunca cero silencioso', () => {
  const targets = [{ name: 'repo-vacio', commits: [] }];
  const result = correlateCoChanges({
    origin,
    targets,
    touchedPaths: ['src/api.js'],
    windowHours: 48,
  });
  assert.equal(result.byRepo.length, 0);
  assert.equal(result.noSignal.length, 1);
  assert.equal(result.noSignal[0].repo, 'repo-vacio');
  assert.ok(result.noSignal[0].reason.includes('historial'));
});

test('origen sin commits del área tocada: todos los targets quedan noSignal', () => {
  const targets = [
    { name: 'repo-b', commits: [commit('b1', iso(0), ['src/consumer.js'])] },
  ];
  const result = correlateCoChanges({
    origin,
    targets,
    touchedPaths: ['src/inexistente.js'],
    windowHours: 48,
  });
  assert.equal(result.byRepo.length, 0);
  assert.equal(result.noSignal.length, 1);
  assert.ok(result.noSignal[0].reason.includes('área'));
});

test('touchedPaths vacío = CoChangeError', () => {
  assert.throws(
    () => correlateCoChanges({ origin, targets: [], touchedPaths: [], windowHours: 48 }),
    CoChangeError,
  );
});

test('readRepoHistory: lee commits reales con ficheros y fechas', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-git-'));
  const git = (...args) =>
    run('git', ['-C', dir, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
  await git('init', '--quiet');
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'a.js'), 'export const a = 1;\n');
  await git('add', '.');
  await git('commit', '--quiet', '--no-verify', '-m', 'primero');
  await writeFile(join(dir, 'src', 'b.js'), 'export const b = 2;\n');
  await git('add', '.');
  await git('commit', '--quiet', '--no-verify', '-m', 'segundo');

  const commits = await readRepoHistory(dir);
  assert.equal(commits.length, 2);
  // Orden cronológico ascendente y ficheros por commit.
  assert.deepEqual(commits[0].files, ['src/a.js']);
  assert.deepEqual(commits[1].files, ['src/b.js']);
  assert.ok(commits.every((c) => c.hash.length >= 7 && !Number.isNaN(Date.parse(c.date))));
});

test('readRepoHistory: directorio sin git = CoChangeError', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-nogit-'));
  await assert.rejects(
    () => readRepoHistory(dir),
    (err) => err instanceof CoChangeError && err.message.includes(dir),
  );
});
