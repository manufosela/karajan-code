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

test('runPipeline: emite onStageStart + onStageEnd por cada stage exitoso', async () => {
  /** @type {any[]} */
  const events = [];
  const stages = [
    { name: 'double', run: async (n) => n * 2 },
    { name: 'stringify', run: async (n) => `v${n}` },
  ];
  await runPipeline(stages, 5, ctx(), {
    events: {
      onStageStart: (e) => events.push({ kind: 'start', ...e }),
      onStageEnd: (e) => events.push({ kind: 'end', ...e }),
      onStageError: (e) => events.push({ kind: 'error', ...e }),
    },
  });

  assert.deepEqual(
    events.map((e) => `${e.kind}:${e.stageName}`),
    ['start:double', 'end:double', 'start:stringify', 'end:stringify'],
  );
  assert.equal(events[0].stageIndex, 0);
  assert.equal(events[3].stageIndex, 1);
  // durationMs sensible y positiva
  for (const e of events) {
    if (e.kind === 'end') {
      assert.ok(typeof e.durationMs === 'number');
      assert.ok(e.durationMs >= 0);
    }
  }
});

test('runPipeline: onStageEnd reporta inputSize/outputSize con estimación', async () => {
  /** @type {any[]} */
  const ends = [];
  const stages = [
    { name: 'arr', run: (s) => s.split('') }, // input string → output array
  ];
  await runPipeline(stages, 'hola', ctx(), {
    events: { onStageEnd: (e) => ends.push(e) },
  });
  assert.equal(ends.length, 1);
  assert.equal(ends[0].inputSize, 4); // 'hola'.length
  assert.equal(ends[0].outputSize, 4); // ['h','o','l','a'].length
});

test('runPipeline: onStageError se emite y onStageEnd NO en stages que fallan (errorPolicy=abort)', async () => {
  /** @type {any[]} */
  const events = [];
  const stages = [
    { name: 'good', run: (n) => n + 1 },
    { name: 'bad', run: () => { throw new Error('boom'); } },
    { name: 'never', run: (n) => n + 100 },
  ];
  await runPipeline(stages, 0, ctx(), {
    events: {
      onStageStart: (e) => events.push({ kind: 'start', stage: e.stageName }),
      onStageEnd: (e) => events.push({ kind: 'end', stage: e.stageName }),
      onStageError: (e) => events.push({ kind: 'error', stage: e.stageName, msg: e.error.message }),
    },
  });
  assert.deepEqual(
    events.map((e) => `${e.kind}:${e.stage}`),
    ['start:good', 'end:good', 'start:bad', 'error:bad'],
  );
  const errorEvent = events.find((e) => e.kind === 'error');
  assert.equal(errorEvent.msg, 'boom');
});

test('runPipeline: errorPolicy=continue sigue emitiendo start para los stages siguientes', async () => {
  /** @type {any[]} */
  const kinds = [];
  const stages = [
    { name: 'bad', run: () => { throw new Error('x'); } },
    { name: 'good', run: (input) => input },
  ];
  await runPipeline(stages, 'hola', ctx(), {
    errorPolicy: 'continue',
    events: {
      onStageStart: (e) => kinds.push(`start:${e.stageName}`),
      onStageEnd: (e) => kinds.push(`end:${e.stageName}`),
      onStageError: (e) => kinds.push(`error:${e.stageName}`),
    },
  });
  assert.deepEqual(kinds, ['start:bad', 'error:bad', 'start:good', 'end:good']);
});

test('runPipeline: hooks que lanzan no rompen el pipeline', async () => {
  const stages = [
    { name: 'calc', run: (n) => n * 3 },
  ];
  const result = await runPipeline(stages, 4, ctx(), {
    events: {
      onStageStart: () => { throw new Error('observer falló'); },
      onStageEnd: () => { throw new Error('tambien falló'); },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.output, 12);
});

test('runPipeline: canRun=false no dispara ningún evento del stage saltado', async () => {
  /** @type {string[]} */
  const seen = [];
  const stages = [
    { name: 'skipped', run: () => 'nope', canRun: () => false },
    { name: 'run', run: (input) => input },
  ];
  await runPipeline(stages, 42, ctx(), {
    events: {
      onStageStart: (e) => seen.push(`start:${e.stageName}`),
      onStageEnd: (e) => seen.push(`end:${e.stageName}`),
    },
  });
  assert.deepEqual(seen, ['start:run', 'end:run']);
});
