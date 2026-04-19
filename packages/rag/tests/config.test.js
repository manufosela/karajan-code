// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  validatePipelineConfig,
  loadPipelineConfig,
} from '../src/config/pipeline-config.js';
import { buildPipelineFromConfig } from '../src/config/pipeline-builder.js';
import { RoleRegistry } from '../src/pipeline/role-registry.js';
import { Role } from '../src/pipeline/role.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

class EchoRole extends Role {
  async run(input) {
    return { echo: input };
  }
}

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'kjr-config-'));
}

test('validatePipelineConfig: acepta config mínima válida', () => {
  const cfg = validatePipelineConfig({
    name: 'p',
    stages: [{ role: 'echo' }, { role: 'echo', name: 'echo2', options: { x: 1 } }],
  });
  assert.equal(cfg.name, 'p');
  assert.equal(cfg.stages.length, 2);
  assert.equal(cfg.stages[1].name, 'echo2');
  assert.deepEqual(cfg.stages[1].options, { x: 1 });
});

test('validatePipelineConfig: rechaza si faltan campos', () => {
  // @ts-expect-error missing
  assert.throws(() => validatePipelineConfig({}), /name/);
  // @ts-expect-error missing
  assert.throws(() => validatePipelineConfig({ name: 'x' }), /stages/);
  assert.throws(
    // @ts-expect-error invalid
    () => validatePipelineConfig({ name: 'x', stages: [] }),
    /array no vac/,
  );
  assert.throws(
    // @ts-expect-error missing role
    () => validatePipelineConfig({ name: 'x', stages: [{}] }),
    /role/,
  );
});

test('validatePipelineConfig: respeta errorPolicy válido y descarta otros', () => {
  const ok = validatePipelineConfig({ name: 'p', stages: [{ role: 'r' }], errorPolicy: 'continue' });
  assert.equal(ok.errorPolicy, 'continue');
  const noPolicy = validatePipelineConfig({
    name: 'p',
    stages: [{ role: 'r' }],
    // @ts-expect-error valor inválido
    errorPolicy: 'wrong',
  });
  assert.equal(noPolicy.errorPolicy, undefined);
});

test('loadPipelineConfig: carga JSON válido desde disco', async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'p.json');
  writeFileSync(
    file,
    JSON.stringify({ name: 'demo', stages: [{ role: 'echo' }] }),
  );
  try {
    const cfg = await loadPipelineConfig(file);
    assert.equal(cfg.name, 'demo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadPipelineConfig: JSON malformado lanza con path', async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'bad.json');
  writeFileSync(file, '{ not json');
  try {
    await assert.rejects(() => loadPipelineConfig(file), /JSON inv/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPipelineFromConfig: construye Stages ejecutables', async () => {
  const registry = new RoleRegistry();
  registry.register('echo', () => new EchoRole({ name: 'echo', logger: silentLogger() }));
  const stages = buildPipelineFromConfig(
    { name: 'p', stages: [{ role: 'echo', options: { foo: 'bar' } }] },
    registry,
  );
  assert.equal(stages.length, 1);
  const ctx = { logger: silentLogger(), tools: { get: () => null, has: () => false }, metadata: {}, errors: [] };
  const out = await stages[0].run({ value: 42 }, ctx);
  assert.deepEqual(out, { echo: { foo: 'bar', value: 42 } });
});

test('buildPipelineFromConfig: rol inexistente lanza con disponibles', () => {
  const registry = new RoleRegistry();
  registry.register('a', () => new EchoRole({ name: 'a', logger: silentLogger() }));
  assert.throws(
    () => buildPipelineFromConfig({ name: 'p', stages: [{ role: 'z' }] }, registry),
    /no registrado.*a/,
  );
});

test('buildPipelineFromConfig: valida registry', () => {
  // @ts-expect-error invalid registry
  assert.throws(() => buildPipelineFromConfig({ name: 'p', stages: [{ role: 'x' }] }, {}), /Registry/);
});

test('CLI: --help devuelve exit 0 y muestra Usage', () => {
  const res = spawnSync(process.execPath, ['bin/karajan-rag.js', '--help'], {
    cwd: path.resolve('.'),
  });
  assert.equal(res.status, 0);
  assert.ok(res.stderr.toString().includes('Usage'));
});

test('CLI: comando desconocido devuelve exit 2', () => {
  const res = spawnSync(process.execPath, ['bin/karajan-rag.js', 'foo'], {
    cwd: path.resolve('.'),
  });
  assert.equal(res.status, 2);
});

test('CLI: run sin config devuelve exit 2', () => {
  const res = spawnSync(process.execPath, ['bin/karajan-rag.js', 'run'], {
    cwd: path.resolve('.'),
  });
  assert.equal(res.status, 2);
});
