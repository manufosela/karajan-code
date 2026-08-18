// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapAdapterAsStream } from '../src/ai/adapters/wrap-adapter-as-stream.js';

/** @returns {import('../src/ai/adapter-registry.js').AdapterFunction} */
function fakeTextAdapter(text) {
  return async () => ({
    provider: 'fake',
    parsedOutput: { format: 'text', text },
    process: { exitCode: 0, stderr: '' },
    providerMeta: {},
  });
}

/** @returns {import('../src/ai/adapter-registry.js').AdapterFunction} */
function fakeJsonAdapter(obj) {
  return async () => ({
    provider: 'fake',
    parsedOutput: { format: 'json', text: JSON.stringify(obj), json: obj },
    process: { exitCode: 0, stderr: '' },
    providerMeta: {},
  });
}

test('wrapAdapterAsStream: trocea texto en chunks del tamaño indicado', async () => {
  const adapter = fakeTextAdapter('0123456789');
  const stream = wrapAdapterAsStream(adapter, { chunkSize: 3 });
  const out = [];
  for await (const chunk of stream('p')) out.push(chunk);
  assert.deepEqual(out, ['012', '345', '678', '9']);
});

test('wrapAdapterAsStream: adapter JSON con campo answer usa ese string', async () => {
  const adapter = fakeJsonAdapter({ answer: 'hola mundo', other: 'ignored' });
  const stream = wrapAdapterAsStream(adapter, { chunkSize: 5 });
  const out = [];
  for await (const chunk of stream('p')) out.push(chunk);
  assert.deepEqual(out.join(''), 'hola mundo');
});

test('wrapAdapterAsStream: texto vacío no emite nada', async () => {
  const adapter = fakeTextAdapter('');
  const stream = wrapAdapterAsStream(adapter);
  const out = [];
  for await (const chunk of stream('p')) out.push(chunk);
  assert.deepEqual(out, []);
});

test('wrapAdapterAsStream: chunkSize por defecto es 32', async () => {
  const text = 'a'.repeat(100);
  const adapter = fakeTextAdapter(text);
  const stream = wrapAdapterAsStream(adapter);
  const out = [];
  for await (const chunk of stream('p')) out.push(chunk);
  assert.equal(out.length, Math.ceil(100 / 32));
  assert.equal(out.join(''), text);
});

test('wrapAdapterAsStream: delayMs>0 introduce al menos esa espera entre chunks', async () => {
  const adapter = fakeTextAdapter('aaaaaa');
  const stream = wrapAdapterAsStream(adapter, { chunkSize: 2, delayMs: 10 });
  const t0 = Date.now();
  const out = [];
  for await (const chunk of stream('p')) out.push(chunk);
  const elapsed = Date.now() - t0;
  // 3 chunks → 2 gaps de 10ms cada uno → al menos ~20ms (margen generoso)
  assert.ok(out.length === 3);
  assert.ok(elapsed >= 15, `elapsed ${elapsed}ms debe ser >= ~15ms`);
});

test('wrapAdapterAsStream: rechaza adapter no-función', () => {
  // @ts-expect-error invalid
  assert.throws(() => wrapAdapterAsStream(null), /adapter/);
  // @ts-expect-error invalid
  assert.throws(() => wrapAdapterAsStream({}), /adapter/);
});

test('wrapAdapterAsStream: se puede usar directamente con GeneratorRole.streamGenerate', async () => {
  const { GeneratorRole } = await import('../src/generation/generator-role.js');
  const adapter = fakeTextAdapter('respuesta no-streaming');
  const streamAdapter = wrapAdapterAsStream(adapter, { chunkSize: 5 });
  const gen = new GeneratorRole({
    name: 'gen',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    streamAdapter,
  });
  const tools = { get: () => { throw new Error('n/a'); }, has: () => false };
  const out = [];
  for await (const chunk of gen.streamGenerate({ query: 'q' }, tools)) {
    out.push(chunk);
  }
  assert.equal(out.join(''), 'respuesta no-streaming');
});

test('wrapAdapterAsStream: result malformado no rompe (devuelve 0 chunks)', async () => {
  const adapter = async () => /** @type {any} */ (null);
  const stream = wrapAdapterAsStream(adapter);
  const out = [];
  for await (const chunk of stream('p')) out.push(chunk);
  assert.deepEqual(out, []);
});
