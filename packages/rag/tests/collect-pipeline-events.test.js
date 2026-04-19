// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, createPipelineContext } from '../src/pipeline/pipeline.js';
import { collectPipelineEvents } from '../src/pipeline/collect-events.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

function emptyTools() {
  return { get: () => { throw new Error('n/a'); }, has: () => false };
}

function ctx() {
  return createPipelineContext({ logger: silentLogger(), tools: emptyTools() });
}

test('collectPipelineEvents: acumula start+end en orden para stages exitosos', async () => {
  const { events, hooks } = collectPipelineEvents();
  const stages = [
    { name: 'a', run: (x) => x + 1 },
    { name: 'b', run: (x) => x * 2 },
  ];
  await runPipeline(stages, 1, ctx(), { events: hooks });
  assert.deepEqual(
    events.map((e) => `${e.kind}:${e.stageName}`),
    ['start:a', 'end:a', 'start:b', 'end:b'],
  );
});

test('collectPipelineEvents: registra error event y corta end cuando stage falla (abort)', async () => {
  const { events, hooks } = collectPipelineEvents();
  const stages = [
    { name: 'good', run: (x) => x },
    { name: 'bad', run: () => { throw new Error('boom'); } },
    { name: 'never', run: () => 'x' },
  ];
  await runPipeline(stages, 'in', ctx(), { events: hooks });
  assert.deepEqual(
    events.map((e) => `${e.kind}:${e.stageName}`),
    ['start:good', 'end:good', 'start:bad', 'error:bad'],
  );
  const errorEvent = events.find((e) => e.kind === 'error');
  assert.equal(errorEvent?.error?.message, 'boom');
});

test('collectPipelineEvents: events contiene durationMs/inputSize/outputSize en end', async () => {
  const { events, hooks } = collectPipelineEvents();
  const stages = [
    { name: 's', run: (str) => str.split('') },
  ];
  await runPipeline(stages, 'abcd', ctx(), { events: hooks });
  const endEvent = events.find((e) => e.kind === 'end');
  assert.ok(endEvent);
  assert.equal(endEvent.inputSize, 4);
  assert.equal(endEvent.outputSize, 4);
  assert.ok(typeof endEvent.durationMs === 'number');
});

test('collectPipelineEvents: invocar dos veces da estados independientes', async () => {
  const a = collectPipelineEvents();
  const b = collectPipelineEvents();
  const stages = [{ name: 'x', run: (v) => v }];
  await runPipeline(stages, 1, ctx(), { events: a.hooks });
  await runPipeline(stages, 2, ctx(), { events: b.hooks });
  assert.equal(a.events.length, 2);
  assert.equal(b.events.length, 2);
  assert.notEqual(a.events, b.events);
});

test('collectPipelineEvents: events es mutable (array vivo), no una snapshot', async () => {
  const { events, hooks } = collectPipelineEvents();
  assert.equal(events.length, 0);
  const stages = [
    { name: 'a', run: (v) => v },
    { name: 'b', run: (v) => v },
  ];
  await runPipeline(stages, 1, ctx(), { events: hooks });
  assert.equal(events.length, 4);
});
