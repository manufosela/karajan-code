// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SolomonRole } from '../src/retrieval/solomon-role.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

test('SolomonRole: run lanza con referencia a ADR-003 (stub)', async () => {
  const role = new SolomonRole({ name: 'solomon', logger: silentLogger() });
  await assert.rejects(
    () => role.run(
      { query: 'x', sourceResults: [] },
      { get: () => null, has: () => false },
    ),
    /Solomon: not implemented, see ADR-003/,
  );
});

test('SolomonRole: se puede registrar en un RoleRegistry sin explotar', async () => {
  const { RoleRegistry } = await import('../src/pipeline/role-registry.js');
  const registry = new RoleRegistry();
  registry.register('solomon', () => new SolomonRole({ name: 'solomon', logger: silentLogger() }));
  assert.equal(registry.has('solomon'), true);
  const instance = registry.resolve('solomon');
  assert.ok(instance instanceof SolomonRole);
});
