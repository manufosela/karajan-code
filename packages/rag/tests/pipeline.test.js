// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, createPipelineContext } from '../src/pipeline/pipeline.js';

/**
 * Logger silencioso usable en tests.
 * @returns {import('../src/pipeline/types.js').Logger}
 */
function silentLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
}

/**
 * ToolBox vacío usable en tests que no necesitan herramientas.
 * @returns {import('../src/pipeline/types.js').ToolBox}
 */
function emptyTools() {
  return {
    get: (name) => {
      throw new Error(`Tool "${name}" no registrado`);
    },
    has: () => false,
  };
}

function ctx() {
  return createPipelineContext({ logger: silentLogger(), tools: emptyTools() });
}

test('runPipeline: encadena 3 stages propagando el output', async () => {
  const stages = [
    { name: 'a', run: (input) => input + 1 },
    { name: 'b', run: (input) => input * 2 },
    { name: 'c', run: (input) => `res:${input}` },
  ];
  const result = await runPipeline(stages, 1, ctx());
  assert.equal(result.ok, true);
  assert.equal(result.output, 'res:4'); // ((1+1)*2) -> 4
  assert.deepEqual(result.executedStages, ['a', 'b', 'c']);
  assert.equal(result.errors.length, 0);
});

test('runPipeline: abort (default) detiene al primer error', async () => {
  const stages = [
    { name: 'a', run: () => 'ok' },
    {
      name: 'b',
      run: () => {
        throw new Error('boom');
      },
    },
    { name: 'c', run: () => 'never' },
  ];
  const result = await runPipeline(stages, null, ctx());
  assert.equal(result.ok, false);
  assert.deepEqual(result.executedStages, ['a']);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].stage, 'b');
  assert.equal(result.errors[0].message, 'boom');
});

test('runPipeline: continue acumula errores pero sigue', async () => {
  const stages = [
    {
      name: 'a',
      run: () => {
        throw new Error('first');
      },
    },
    {
      name: 'b',
      run: () => {
        throw new Error('second');
      },
    },
  ];
  const result = await runPipeline(stages, null, ctx(), { errorPolicy: 'continue' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.executedStages, ['a', 'b']);
  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].message, 'first');
  assert.equal(result.errors[1].message, 'second');
});

test('runPipeline: canRun=false salta el stage sin marcarlo como ejecutado', async () => {
  const stages = [
    { name: 'a', run: (i) => i + 1 },
    { name: 'b', run: () => 999, canRun: () => false },
    { name: 'c', run: (i) => i * 10 },
  ];
  const result = await runPipeline(stages, 2, ctx());
  assert.equal(result.ok, true);
  assert.equal(result.output, 30); // a=3 → (b saltado) → c=30
  assert.deepEqual(result.executedStages, ['a', 'c']);
});

test('runPipeline: AbortSignal pre-aborta antes de ejecutar el siguiente stage', async () => {
  const controller = new AbortController();
  const stages = [
    {
      name: 'a',
      run: () => {
        controller.abort();
        return 'done';
      },
    },
    {
      name: 'b',
      run: () => {
        throw new Error('no debería ejecutarse');
      },
    },
  ];
  const c = createPipelineContext({
    logger: silentLogger(),
    tools: emptyTools(),
    signal: controller.signal,
  });
  const result = await runPipeline(stages, null, c);
  assert.equal(result.ok, false);
  assert.deepEqual(result.executedStages, ['a']);
  assert.equal(result.errors.length, 0);
});

test('runPipeline: stage sin "name" falla en validación', async () => {
  const stages = [{ run: () => 'x' }];
  await assert.rejects(
    // @ts-expect-error stage inválido intencional
    () => runPipeline(stages, null, ctx()),
    /stage en posición 0 no tiene "name"/,
  );
});

test('runPipeline: stage sin "run" falla en validación', async () => {
  const stages = [{ name: 'broken' }];
  await assert.rejects(
    // @ts-expect-error stage inválido intencional
    () => runPipeline(stages, null, ctx()),
    /stage "broken" no tiene método "run"/,
  );
});

test('runPipeline: ctx.metadata es accesible y mutable desde stages', async () => {
  const c = createPipelineContext({
    logger: silentLogger(),
    tools: emptyTools(),
    metadata: { counter: 0 },
  });
  const stages = [
    {
      name: 'increment',
      run: (input, stageCtx) => {
        stageCtx.metadata.counter = Number(stageCtx.metadata.counter) + 1;
        return input;
      },
    },
    {
      name: 'increment2',
      run: (input, stageCtx) => {
        stageCtx.metadata.counter = Number(stageCtx.metadata.counter) + 1;
        return input;
      },
    },
  ];
  await runPipeline(stages, 'x', c);
  assert.equal(c.metadata.counter, 2);
});

test('createPipelineContext: rechaza si faltan logger/tools', () => {
  // @ts-expect-error missing parts
  assert.throws(() => createPipelineContext({ logger: silentLogger() }), /se requieren/);
  // @ts-expect-error missing parts
  assert.throws(() => createPipelineContext({ tools: emptyTools() }), /se requieren/);
});
