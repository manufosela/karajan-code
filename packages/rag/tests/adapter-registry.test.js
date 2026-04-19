// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdapterRegistry } from '../src/ai/adapter-registry.js';
import { runMultiCli } from '../src/ai/multi-cli-orchestrator.js';

/**
 * Fake adapter: devuelve un AdapterResult fijo sin spawnear procesos.
 *
 * @param {string} provider
 * @param {string} answer
 * @returns {import('../src/ai/adapter-registry.js').AdapterFunction}
 */
function makeFakeAdapter(provider, answer) {
  return async (prompt) => ({
    provider,
    process: {
      stdout: JSON.stringify({ answer }),
      stderr: '',
      exitCode: 0,
      signal: null,
      timedOut: false,
    },
    parsedOutput: {
      format: 'json',
      json: { answer, prompt },
      text: JSON.stringify({ answer }),
    },
  });
}

test('AdapterRegistry: register + get ejecuta la función', async () => {
  const registry = new AdapterRegistry();
  registry.register('fake', makeFakeAdapter('fake', 'pong'));
  const adapter = registry.get('fake');
  const result = await adapter('ping');
  assert.equal(result.provider, 'fake');
  assert.deepEqual(result.parsedOutput.json, { answer: 'pong', prompt: 'ping' });
});

test('AdapterRegistry: get de adapter inexistente lanza con disponibles', () => {
  const registry = new AdapterRegistry();
  registry.register('a', makeFakeAdapter('a', 'x'));
  assert.throws(() => registry.get('z'), /no registrado.*a/);
});

test('AdapterRegistry: duplicate register lanza', () => {
  const registry = new AdapterRegistry();
  registry.register('a', makeFakeAdapter('a', 'x'));
  assert.throws(() => registry.register('a', makeFakeAdapter('a', 'y')), /ya existe/);
});

test('AdapterRegistry: has/list/describe funcionan', () => {
  const registry = new AdapterRegistry();
  registry.register('a', makeFakeAdapter('a', 'x'), { bin: 'a-bin' });
  registry.register('b', makeFakeAdapter('b', 'y'), { bin: 'b-bin' });

  assert.equal(registry.has('a'), true);
  assert.equal(registry.has('c'), false);
  assert.deepEqual(registry.list().sort(), ['a', 'b']);

  const described = registry.describe();
  assert.equal(described.length, 2);
  const a = described.find((d) => d.name === 'a');
  assert.ok(a);
  assert.equal(a.meta.bin, 'a-bin');
});

test('AdapterRegistry: getMeta devuelve copia defensiva', () => {
  const registry = new AdapterRegistry();
  registry.register('a', makeFakeAdapter('a', 'x'), { bin: 'a-bin' });
  const meta = registry.getMeta('a');
  assert.deepEqual(meta, { bin: 'a-bin' });
  meta.bin = 'mutated';
  assert.equal(registry.getMeta('a').bin, 'a-bin');
});

test('AdapterRegistry: unregister elimina y devuelve booleano', () => {
  const registry = new AdapterRegistry();
  registry.register('a', makeFakeAdapter('a', 'x'));
  assert.equal(registry.unregister('a'), true);
  assert.equal(registry.has('a'), false);
  assert.equal(registry.unregister('a'), false);
});

test('AdapterRegistry: register valida name y fn', () => {
  const registry = new AdapterRegistry();
  // @ts-expect-error invalid name
  assert.throws(() => registry.register('', () => null), /name/);
  // @ts-expect-error invalid fn
  assert.throws(() => registry.register('x', 'not-a-fn'), /función/);
});

test('runMultiCli: usa el registry inyectado y no los 3 defaults', async () => {
  const registry = new AdapterRegistry();
  registry.register('fakeA', makeFakeAdapter('fakeA', 'resA'));
  registry.register('fakeB', makeFakeAdapter('fakeB', 'resB'));
  const results = await runMultiCli('test', { registry });
  assert.equal(results.length, 2);
  assert.equal(results[0].provider, 'fakeA');
  assert.equal(results[1].provider, 'fakeB');
});

test('runMultiCli: providers filtra subconjunto del registry', async () => {
  const registry = new AdapterRegistry();
  registry.register('a', makeFakeAdapter('a', '1'));
  registry.register('b', makeFakeAdapter('b', '2'));
  registry.register('c', makeFakeAdapter('c', '3'));
  const results = await runMultiCli('prompt', { registry, providers: ['b'] });
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'b');
});

test('runMultiCli: fallo de un provider no rompe los demás', async () => {
  const registry = new AdapterRegistry();
  registry.register('ok', makeFakeAdapter('ok', 'fine'));
  registry.register('bad', async () => {
    throw new Error('proveedor caído');
  });
  const results = await runMultiCli('x', { registry });
  assert.equal(results.length, 2);
  assert.equal(results[0].provider, 'ok');
  assert.equal(results[1].provider, 'bad');
  assert.equal(/** @type {any} */ (results[1]).error, 'proveedor caído');
});

test('runMultiCli: registry vacío devuelve array vacío', async () => {
  const registry = new AdapterRegistry();
  const results = await runMultiCli('x', { registry });
  assert.deepEqual(results, []);
});
