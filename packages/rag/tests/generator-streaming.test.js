// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeneratorRole } from '../src/generation/generator-role.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

function emptyTools() {
  return {
    get: (name) => { throw new Error(`Tool "${name}" no registrado`); },
    has: () => false,
  };
}

/**
 * Crea un ToolBox que expone una sola tool por nombre.
 * @param {string} name
 * @param {unknown} value
 */
function toolsWith(name, value) {
  return {
    get: (n) => { if (n === name) return value; throw new Error('n/a'); },
    has: (n) => n === name,
  };
}

/**
 * Adapter streaming que emite los tokens pasados.
 * @param {string[]} tokens
 */
function makeStreamAdapter(tokens) {
  return async function* (prompt) {
    void prompt;
    for (const t of tokens) {
      yield t;
    }
  };
}

test('streamGenerate: usa streamAdapter directo y concatena tokens', async () => {
  const gen = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    streamAdapter: makeStreamAdapter(['Hola ', 'mundo', '!']),
  });
  const chunks = [];
  for await (const c of gen.streamGenerate({ query: '¿qué?', contextChunks: [] }, emptyTools())) {
    chunks.push(c);
  }
  assert.deepEqual(chunks, ['Hola ', 'mundo', '!']);
});

test('streamGenerate: resuelve streamAdapter por nombre desde tools', async () => {
  const gen = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    streamAdapterName: 'claude-stream',
  });
  const tools = toolsWith('claude-stream', makeStreamAdapter(['a', 'b']));
  const out = [];
  for await (const c of gen.streamGenerate({ query: 'q' }, tools)) {
    out.push(c);
  }
  assert.deepEqual(out, ['a', 'b']);
});

test('streamGenerate: sin streamAdapter hace fallback a adapter no-streaming (un solo yield)', async () => {
  const fakeAdapter = async (prompt) => {
    void prompt;
    return {
      provider: 'fake',
      parsedOutput: { format: 'text', text: 'respuesta completa' },
      process: { exitCode: 0, stderr: '' },
      providerMeta: {},
    };
  };
  const gen = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    adapter: fakeAdapter,
  });
  const out = [];
  for await (const c of gen.streamGenerate({ query: 'q' }, emptyTools())) {
    out.push(c);
  }
  assert.deepEqual(out, ['respuesta completa']);
});

test('streamGenerate: sin query lanza', async () => {
  const gen = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    streamAdapter: makeStreamAdapter([]),
  });
  const iter = gen.streamGenerate(/** @type {any} */ ({}), emptyTools());
  await assert.rejects(() => iter.next(), /query requerido/);
});

test('streamGenerate: forceCitation afecta al prompt pasado al streamAdapter', async () => {
  /** @type {string|null} */
  let capturedPrompt = null;
  const stream = async function* (prompt) {
    capturedPrompt = prompt;
    yield 'ok';
  };
  const gen = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    streamAdapter: stream,
    forceCitation: true,
  });
  const hits = [
    { id: 'doc1', score: 0.9, vector: [0], metadata: { content: 'chunk A', index: 0 } },
  ];
  const iter = gen.streamGenerate({ query: 'q', contextChunks: hits }, emptyTools());
  for await (const chunk of iter) {
    void chunk;
  }
  assert.match(capturedPrompt ?? '', /\[id=<source>, chunk=<index>\]/);
});

test('streamGenerate: sin adapter ni streamAdapter y sin tools lanza', async () => {
  const gen = new GeneratorRole({ name: 'gen', logger: silentLogger() });
  const iter = gen.streamGenerate({ query: 'q' }, emptyTools());
  await assert.rejects(() => iter.next(), /adapter/);
});

test('generate tradicional sigue funcionando tras añadir streamGenerate', async () => {
  const fakeAdapter = async () => ({
    provider: 'fake',
    parsedOutput: { format: 'text', text: 'clásico' },
    process: { exitCode: 0, stderr: '' },
    providerMeta: {},
  });
  const gen = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    adapter: fakeAdapter,
  });
  const res = await gen.run({ query: 'q' }, emptyTools());
  assert.equal(res.answer, 'clásico');
});
