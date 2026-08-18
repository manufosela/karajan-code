// @ts-check
// Persistencia de informes (KJW-TSK-0024).
//
// El comentario de una PR es efímero: se pierde en cuanto la PR se cierra, y
// con él la única constancia de qué se avisó. Guardar el informe permite
// mirar la evolución del riesgo — y alimentar un dashboard cuando lo haya.
//
// Por defecto va a FICHERO, no a Postgres: una instancia arranca sin base de
// datos (KJW-TSK-0032) y el historial no debería ser el motivo de montar una.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from '../src/config.js';
import { HistoryError, appendReport, readHistory } from '../src/history.js';

const withHistory = (history) =>
  validateConfig({ repos: [{ name: 'repo-a' }], history });

const sampleReport = (overrides = {}) => ({
  kind: 'impact',
  repo: 'repo-a',
  diffSummary: 'repo-a: src/routes.js (1 chunks)',
  measuredWith: { store: 'lancedb', embedder: 'hash' },
  entries: [
    {
      source: 'repo-b/src/cliente.js',
      score: 0.42,
      contract: { tokens: [{ value: '/api/v1/users/:id', type: 'http', removed: true }] },
    },
  ],
  ...overrides,
});

test('sin la sección history no se escribe nada: es opt-in', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-hist-'));
  const result = await appendReport({
    config: validateConfig({ repos: [{ name: 'repo-a' }] }),
    report: sampleReport(),
    workspaceDir: dir,
    now: () => new Date('2026-08-10T20:00:00Z'),
  });

  assert.equal(result.persisted, false);
  assert.deepEqual(await readdir(dir), [], 'ni siquiera debe crear el directorio');
});

test('activado: escribe una línea NDJSON con el informe y cuándo se produjo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-hist-'));
  const result = await appendReport({
    config: withHistory({ enabled: true }),
    report: sampleReport(),
    workspaceDir: dir,
    now: () => new Date('2026-08-10T20:00:00Z'),
  });

  assert.equal(result.persisted, true);
  const written = JSON.parse(await readFile(result.path, 'utf8'));
  assert.equal(written.kind, 'impact');
  assert.equal(written.repo, 'repo-a');
  assert.equal(written.at, '2026-08-10T20:00:00.000Z');
  assert.deepEqual(written.measuredWith, { store: 'lancedb', embedder: 'hash' });
  assert.equal(written.entries[0].source, 'repo-b/src/cliente.js');
  assert.equal(
    written.entries[0].contract.tokens[0].value,
    '/api/v1/users/:id',
    'la evidencia citada se guarda: sin ella el histórico no explica nada',
  );
});

test('varios runs se acumulan, uno por línea, sin pisarse', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-hist-'));
  const config = withHistory({ enabled: true });
  for (const kind of ['impact', 'drift', 'impact']) {
    await appendReport({
      config,
      report: sampleReport({ kind }),
      workspaceDir: dir,
      now: () => new Date('2026-08-10T20:00:00Z'),
    });
  }

  const records = await readHistory({ config, workspaceDir: dir });
  assert.equal(records.length, 3);
  assert.deepEqual(records.map((r) => r.kind), ['impact', 'drift', 'impact']);
});

test('la PII se redacta antes de guardar, igual que en el informe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-hist-'));
  const result = await appendReport({
    config: withHistory({ enabled: true }),
    report: sampleReport({ diffSummary: 'reportado por alguien@example.com' }),
    workspaceDir: dir,
    now: () => new Date('2026-08-10T20:00:00Z'),
  });

  const written = await readFile(result.path, 'utf8');
  assert.doesNotMatch(written, /alguien@example\.com/, 'un histórico es tan público como su fichero');
});

test('retención: los registros viejos se van, los recientes se quedan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-hist-'));
  const config = withHistory({ enabled: true, retentionDays: 30 });
  const ahora = new Date('2026-08-10T20:00:00Z');

  await appendReport({
    config,
    report: sampleReport({ diffSummary: 'antiguo' }),
    workspaceDir: dir,
    now: () => new Date('2026-01-01T00:00:00Z'),
  });
  await appendReport({
    config,
    report: sampleReport({ diffSummary: 'reciente' }),
    workspaceDir: dir,
    now: () => ahora,
  });

  const records = await readHistory({ config, workspaceDir: dir, now: () => ahora });
  assert.equal(records.length, 1);
  assert.equal(records[0].diffSummary, 'reciente');
});

test('sin retención declarada no se borra nada nunca', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-hist-'));
  const config = withHistory({ enabled: true });
  await appendReport({
    config,
    report: sampleReport({ diffSummary: 'de hace años' }),
    workspaceDir: dir,
    now: () => new Date('2020-01-01T00:00:00Z'),
  });

  const records = await readHistory({
    config,
    workspaceDir: dir,
    now: () => new Date('2026-08-10T20:00:00Z'),
  });
  assert.equal(records.length, 1, 'borrar histórico jamás debe ser un default');
});

test('una línea corrupta no se traga el histórico entero', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-hist-'));
  const config = withHistory({ enabled: true });
  const { path } = await appendReport({
    config,
    report: sampleReport(),
    workspaceDir: dir,
    now: () => new Date('2026-08-10T20:00:00Z'),
  });
  await writeFile(path, (await readFile(path, 'utf8')) + '{ esto no es json\n', 'utf8');

  await assert.rejects(
    () => readHistory({ config, workspaceDir: dir }),
    (err) => err instanceof HistoryError && /línea/i.test(err.message),
    'leer basura en silencio daría un histórico incompleto sin avisar',
  );
});

test('el directorio se puede elegir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-hist-'));
  const result = await appendReport({
    config: withHistory({ enabled: true, dir: 'informes' }),
    report: sampleReport(),
    workspaceDir: dir,
    now: () => new Date('2026-08-10T20:00:00Z'),
  });
  assert.match(result.path, /informes/);
});

test('un score con muchos decimales no rompe el JSON guardado', async () => {
  // Redactar el JSON ya serializado lo corrompía: `0.15476923` se leía como
  // número de tarjeta y quedaba `"score":0.[REDACTED_CARD]`, ilegible. Lo
  // encontró el smoke real, no estos tests, porque aquí los scores eran
  // cortos. Ahora la redacción va campo a campo.
  const dir = await mkdtemp(join(tmpdir(), 'kjw-hist-'));
  const result = await appendReport({
    config: withHistory({ enabled: true }),
    report: sampleReport({
      entries: [{ source: 'repo-b/src/x.js', score: 0.15476923456789, line: 4712345 }],
    }),
    workspaceDir: dir,
    now: () => new Date('2026-08-10T20:00:00Z'),
  });

  const written = JSON.parse(await readFile(result.path, 'utf8'));
  assert.equal(written.entries[0].score, 0.15476923456789, 'los números se guardan tal cual');
  assert.equal(written.entries[0].line, 4712345);
});
