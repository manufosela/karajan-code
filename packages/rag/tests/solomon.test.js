// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SolomonRole } from '../src/retrieval/solomon-role.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

test('SolomonRole: run con 0 sources devuelve verdict vacío (no stub)', async () => {
  const role = new SolomonRole({ name: 'solomon', logger: silentLogger() });
  const verdict = await role.run(
    { query: 'x', sourceResults: [] },
    { get: () => null, has: () => false, metadata: {}, logger: silentLogger() },
  );
  assert.equal(verdict.strategy, 'majority');
  assert.deepEqual(verdict.chunks, []);
});

test('SolomonRole: se puede registrar en un RoleRegistry sin explotar', async () => {
  const { RoleRegistry } = await import('../src/pipeline/role-registry.js');
  const registry = new RoleRegistry();
  registry.register('solomon', () => new SolomonRole({ name: 'solomon', logger: silentLogger() }));
  assert.equal(registry.has('solomon'), true);
  const instance = registry.resolve('solomon');
  assert.ok(instance instanceof SolomonRole);
});
