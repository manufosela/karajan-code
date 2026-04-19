// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeneratorRole } from '../src/generation/generator-role.js';
import {
  evaluateMultiJudge,
  buildJudgePrompt,
} from '../src/evaluation/multi-judge-evaluator.js';
import { AdapterRegistry } from '../src/ai/adapter-registry.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function makeAdapterReturning(json, text = '') {
  return async () => ({
    provider: 'fake',
    process: { stdout: text, stderr: '', exitCode: 0, signal: null, timedOut: false },
    parsedOutput: {
      format: json ? 'json' : 'text',
      json,
      text,
    },
  });
}

test('GeneratorRole.buildPrompt: incluye contexto numerado y la pregunta', () => {
  const role = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    adapter: makeAdapterReturning(null, 'ignored'),
  });
  const prompt = role.buildPrompt('¿Qué es X?', [
    { id: 'c1', score: 1, vector: [], metadata: { content: 'X es una cosa.' } },
    { id: 'c2', score: 0.5, vector: [], metadata: { content: 'Y es otra cosa.' } },
  ]);
  assert.ok(prompt.includes('[1]'));
  assert.ok(prompt.includes('[2]'));
  assert.ok(prompt.includes('¿Qué es X?'));
  assert.ok(prompt.includes('X es una cosa.'));
});

test('GeneratorRole.buildPrompt: sin chunks advierte de la ausencia', () => {
  const role = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    adapter: makeAdapterReturning(null),
  });
  const prompt = role.buildPrompt('q', []);
  assert.ok(prompt.includes('Sin contexto recuperado'));
});

test('GeneratorRole.run: extrae answer del parsedOutput.json', async () => {
  const role = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    adapter: makeAdapterReturning({ answer: 'hola' }),
  });
  const out = await role.run(
    { query: 'q', contextChunks: [] },
    { get: () => null, has: () => false },
  );
  assert.equal(out.answer, 'hola');
  assert.ok(out.prompt.includes('q'));
});

test('GeneratorRole.run: sin query lanza', async () => {
  const role = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    adapter: makeAdapterReturning({ answer: 'x' }),
  });
  await assert.rejects(
    // @ts-expect-error input incompleto
    () => role.run({}, { get: () => null, has: () => false }),
    /input\.query/,
  );
});

test('GeneratorRole.run: sin adapter lanza', async () => {
  const role = new GeneratorRole({ name: 'gen', logger: silentLogger() });
  await assert.rejects(
    () => role.run({ query: 'q' }, { get: () => null, has: () => false }),
    /no hay adapter/,
  );
});

test('buildJudgePrompt: incluye pregunta, respuesta y esquema JSON', () => {
  const prompt = buildJudgePrompt({ query: 'q', answer: 'a', context: 'c' });
  assert.ok(prompt.includes('Pregunta: q'));
  assert.ok(prompt.includes('Respuesta: a'));
  assert.ok(prompt.includes('Contexto:'));
  assert.ok(prompt.includes('score'));
});

test('evaluateMultiJudge: agrega scores y detecta consenso', async () => {
  const registry = new AdapterRegistry();
  registry.register('j1', makeAdapterReturning({ score: 0.8, rationale: 'bien' }));
  registry.register('j2', makeAdapterReturning({ score: 0.9, rationale: 'muy bien' }));
  registry.register('j3', makeAdapterReturning({ score: 0.85, rationale: 'ok' }));
  const report = await evaluateMultiJudge({
    registry,
    providers: ['j1', 'j2', 'j3'],
    input: { query: 'q', answer: 'a' },
  });
  assert.ok(report.aggregateScore > 0.8);
  assert.equal(report.disagreement, false);
  assert.equal(report.verdicts.length, 3);
});

test('evaluateMultiJudge: marca disagreement si max-min >= threshold', async () => {
  const registry = new AdapterRegistry();
  registry.register('jA', makeAdapterReturning({ score: 0.2 }));
  registry.register('jB', makeAdapterReturning({ score: 0.9 }));
  const report = await evaluateMultiJudge({
    registry,
    providers: ['jA', 'jB'],
    input: { query: 'q', answer: 'a' },
    disagreementThreshold: 0.3,
  });
  assert.equal(report.disagreement, true);
});

test('evaluateMultiJudge: juez caído no rompe, se marca error', async () => {
  const registry = new AdapterRegistry();
  registry.register('ok', makeAdapterReturning({ score: 0.7 }));
  registry.register('bad', async () => {
    throw new Error('cli caído');
  });
  const report = await evaluateMultiJudge({
    registry,
    providers: ['ok', 'bad'],
    input: { query: 'q', answer: 'a' },
  });
  assert.equal(report.aggregateScore, 0.7);
  assert.equal(report.verdicts.length, 2);
  const bad = report.verdicts.find((v) => v.provider === 'bad');
  assert.ok(bad);
  assert.equal(bad.score, null);
  assert.ok(bad.error?.includes('cli caído'));
});

test('evaluateMultiJudge: todos los jueces sin score devuelven aggregateScore null', async () => {
  const registry = new AdapterRegistry();
  registry.register('j1', makeAdapterReturning(null, 'no-json'));
  const report = await evaluateMultiJudge({
    registry,
    providers: ['j1'],
    input: { query: 'q', answer: 'a' },
  });
  assert.equal(report.aggregateScore, null);
  assert.equal(report.verdicts[0].score, null);
});

test('evaluateMultiJudge: valida argumentos', async () => {
  await assert.rejects(
    // @ts-expect-error missing registry
    () => evaluateMultiJudge({ providers: ['a'], input: { query: 'q', answer: 'a' } }),
    /registry/,
  );
  const registry = new AdapterRegistry();
  await assert.rejects(
    () => evaluateMultiJudge({ registry, providers: [], input: { query: 'q', answer: 'a' } }),
    /providers/,
  );
});
