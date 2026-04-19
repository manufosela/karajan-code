// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '../src/pipeline/role.js';
import { RoleRegistry } from '../src/pipeline/role-registry.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

class DummyRole extends Role {
  async run(input) {
    return `dummy:${input}`;
  }
}

test('RoleRegistry: register + resolve devuelve una instancia', () => {
  const registry = new RoleRegistry();
  registry.register('dummy', () => new DummyRole({ name: 'dummy', logger: silentLogger() }));
  const instance = registry.resolve('dummy');
  assert.ok(instance instanceof Role);
  assert.equal(instance.name, 'dummy');
});

test('RoleRegistry: resolve devuelve nueva instancia cada vez (factory)', () => {
  const registry = new RoleRegistry();
  registry.register('dummy', () => new DummyRole({ name: 'dummy', logger: silentLogger() }));
  const a = registry.resolve('dummy');
  const b = registry.resolve('dummy');
  assert.notStrictEqual(a, b);
});

test('RoleRegistry: resolve de rol inexistente lanza con lista de disponibles', () => {
  const registry = new RoleRegistry();
  registry.register('foo', () => new DummyRole({ name: 'foo', logger: silentLogger() }));
  registry.register('bar', () => new DummyRole({ name: 'bar', logger: silentLogger() }));
  assert.throws(() => registry.resolve('baz'), /no registrado.*foo.*bar/);
});

test('RoleRegistry: has detecta correctamente', () => {
  const registry = new RoleRegistry();
  registry.register('a', () => new DummyRole({ name: 'a', logger: silentLogger() }));
  assert.equal(registry.has('a'), true);
  assert.equal(registry.has('b'), false);
});

test('RoleRegistry: duplicate register lanza', () => {
  const registry = new RoleRegistry();
  const factory = () => new DummyRole({ name: 'x', logger: silentLogger() });
  registry.register('x', factory);
  assert.throws(() => registry.register('x', factory), /ya existe un rol/);
});

test('RoleRegistry: list devuelve los nombres registrados', () => {
  const registry = new RoleRegistry();
  registry.register('a', () => new DummyRole({ name: 'a', logger: silentLogger() }));
  registry.register('b', () => new DummyRole({ name: 'b', logger: silentLogger() }));
  assert.deepEqual(registry.list().sort(), ['a', 'b']);
});

test('RoleRegistry: unregister elimina y devuelve true', () => {
  const registry = new RoleRegistry();
  registry.register('a', () => new DummyRole({ name: 'a', logger: silentLogger() }));
  assert.equal(registry.unregister('a'), true);
  assert.equal(registry.has('a'), false);
  assert.equal(registry.unregister('a'), false);
});

test('RoleRegistry: register valida name y factory', () => {
  const registry = new RoleRegistry();
  // @ts-expect-error invalid name
  assert.throws(() => registry.register('', () => null), /name/);
  // @ts-expect-error invalid factory
  assert.throws(() => registry.register('x', 'not-a-fn'), /factory/);
});

test('Role.execute emite START/END en éxito', async () => {
  /** @type {string[]} */
  const events = [];
  const role = new DummyRole({
    name: 'dummy',
    logger: silentLogger(),
    notify: (ev) => events.push(ev),
  });
  const output = await role.execute('hello', { get: () => null, has: () => false });
  assert.equal(output, 'dummy:hello');
  assert.deepEqual(events, ['role:start', 'role:end']);
});

test('Role.execute emite START/ERROR cuando run lanza', async () => {
  class BrokenRole extends Role {
    async run() {
      throw new Error('kaboom');
    }
  }
  /** @type {string[]} */
  const events = [];
  const role = new BrokenRole({
    name: 'broken',
    logger: silentLogger(),
    notify: (ev) => events.push(ev),
  });
  await assert.rejects(
    () => role.execute(null, { get: () => null, has: () => false }),
    /kaboom/,
  );
  assert.deepEqual(events, ['role:start', 'role:error']);
});

test('Role: lanza si falta name o logger', () => {
  // @ts-expect-error missing name
  assert.throws(() => new DummyRole({ logger: silentLogger() }), /"name"/);
  // @ts-expect-error missing logger
  assert.throws(() => new DummyRole({ name: 'x' }), /"logger"/);
});
