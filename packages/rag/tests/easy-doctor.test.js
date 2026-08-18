// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runDoctorChecks, runDoctorCommand } from '../src/easy/doctor.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { indexDirectory } from '../src/easy/indexer.js';

/** Deps simuladas: peers instalados, claude en PATH. */
const HAPPY_DEPS = {
  env: { PG_URL: 'postgres://x' },
  importModule: async () => ({}),
  whichBin: async (bin) => bin === 'claude',
  nodeVersion: '22.0.0',
};

function byName(checks, name) {
  const check = checks.find((c) => c.name === name);
  assert.ok(check, `falta el check "${name}"`);
  return check;
}

test('runDoctorChecks: entorno sano reporta ok/warn coherentes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-doctor-'));
  try {
    const checks = await runDoctorChecks(root, HAPPY_DEPS);
    assert.equal(byName(checks, 'node').level, 'ok');
    assert.equal(byName(checks, 'peer pg').level, 'ok');
    assert.equal(byName(checks, 'CLIs de IA').level, 'ok');
    assert.match(byName(checks, 'CLIs de IA').detail, /claude/);
    assert.match(byName(checks, 'env').detail, /PG_URL/);
    const config = byName(checks, 'karajan.config.json');
    assert.equal(config.level, 'warn');
    assert.match(String(config.fix), /karajan-rag init/);
    const index = byName(checks, 'índice');
    assert.equal(index.level, 'warn');
    assert.match(String(index.fix), /karajan-rag index/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runDoctorChecks: peers ausentes y sin CLIs → warns con fix', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-doctor-'));
  try {
    const checks = await runDoctorChecks(root, {
      env: {},
      importModule: async () => {
        throw new Error('not found');
      },
      whichBin: async () => false,
      nodeVersion: '20.1.0',
    });
    const lance = byName(checks, 'peer @lancedb/lancedb');
    assert.equal(lance.level, 'warn');
    assert.match(String(lance.fix), /pnpm add @lancedb\/lancedb/);
    assert.equal(byName(checks, 'CLIs de IA').level, 'warn');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runDoctorChecks: node antiguo y config inválida → errores con fix', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-doctor-'));
  try {
    await writeFile(path.join(root, 'karajan.config.json'), '{"easy":{"store":"redis"}}\n', 'utf8');
    const checks = await runDoctorChecks(root, { ...HAPPY_DEPS, nodeVersion: '16.4.0' });
    assert.equal(byName(checks, 'node').level, 'error');
    const config = byName(checks, 'karajan.config.json');
    assert.equal(config.level, 'error');
    assert.match(config.detail, /easy\.store/);
    assert.match(String(config.fix), /--force/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runDoctorChecks: índice existente reporta fingerprint y contadores', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-doctor-'));
  try {
    await writeFile(path.join(root, 'a.md'), '# A\nuno\n', 'utf8');
    const embedder = createHashEmbedder({ dimensions: 16 });
    const store = new InMemoryVectorStore({ dimensions: 16 });
    await indexDirectory(root, { store, embedder });

    const checks = await runDoctorChecks(root, HAPPY_DEPS);
    const index = byName(checks, 'índice');
    assert.equal(index.level, 'ok');
    assert.match(index.detail, /hash\|16\|.*1 ficheros, \d+ chunks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runDoctorCommand: imprime ✓/⚠ con fixes y agrega contadores', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-doctor-'));
  const lines = [];
  try {
    const { errors, warnings } = await runDoctorCommand([root], {
      out: (msg) => lines.push(msg),
      deps: HAPPY_DEPS,
    });
    assert.equal(errors, 0);
    assert.ok(warnings >= 2, 'config e índice ausentes son avisos');
    assert.ok(lines.some((l) => l.includes('✓ node')));
    assert.ok(lines.some((l) => l.includes('fix: karajan-rag index')));
    assert.ok(lines.at(-1)?.includes('0 errores'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
