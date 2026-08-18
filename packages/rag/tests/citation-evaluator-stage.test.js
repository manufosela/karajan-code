// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeneratorRole, extractCitations } from '../src/generation/generator-role.js';
import { EvaluatorRole } from '../src/evaluation/evaluator-role.js';
import { AdapterRegistry } from '../src/ai/adapter-registry.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function adapterReturning(value) {
  return async () => ({
    provider: 'fake',
    process: { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false },
    parsedOutput: {
      format: 'json',
      json: value,
      text: typeof value === 'string' ? value : JSON.stringify(value),
    },
  });
}

test('extractCitations: parsea [id=X, chunk=Y] deduplicando', () => {
  const answer = 'Afirmación 1 [id=docA, chunk=0]. Afirmación 2 [id=docB, chunk=3]. Repetida [id=docA, chunk=0].';
  const c = extractCitations(answer);
  assert.deepEqual(c, ['[id=docA, chunk=0]', '[id=docB, chunk=3]']);
});

test('extractCitations: texto vacío o sin citas devuelve []', () => {
  assert.deepEqual(extractCitations(''), []);
  assert.deepEqual(extractCitations('sin citas aquí'), []);
  // @ts-expect-error
  assert.deepEqual(extractCitations(null), []);
});

test('GeneratorRole: forceCitation=true añade instrucción de citar al prompt', () => {
  const role = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    adapter: adapterReturning({ answer: 'x' }),
    forceCitation: true,
  });
  const prompt = role.buildPrompt('q', [
    { id: 'doc-1', score: 1, vector: [], metadata: { content: 'texto', index: 0 } },
  ]);
  assert.match(prompt, /OBLIGATORIAMENTE/);
  assert.match(prompt, /\[id=<source>, chunk=<index>\]/);
});

test('GeneratorRole: forceCitation=false omite la instrucción de citar', () => {
  const role = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    adapter: adapterReturning({ answer: 'x' }),
    forceCitation: false,
  });
  const prompt = role.buildPrompt('q', [
    { id: 'doc-1', score: 1, vector: [], metadata: { content: 'texto' } },
  ]);
  assert.doesNotMatch(prompt, /OBLIGATORIAMENTE/);
});

test('GeneratorRole.run: extrae citations del answer', async () => {
  const role = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    adapter: adapterReturning({
      answer: 'Perros ladran [id=doc1, chunk=0]. Gatos maullan [id=doc2, chunk=1].',
    }),
    forceCitation: true,
  });
  const out = await role.run(
    { query: 'q', contextChunks: [] },
    { get: () => null, has: () => false },
  );
  assert.deepEqual(out.citations, ['[id=doc1, chunk=0]', '[id=doc2, chunk=1]']);
});

test('GeneratorRole.run: sin contexto no fuerza cita aunque forceCitation=true', () => {
  const role = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    adapter: adapterReturning({ answer: 'x' }),
    forceCitation: true,
  });
  const prompt = role.buildPrompt('q', []);
  // No hay chunks → no se añade instrucción de citar aunque forceCitation
  assert.doesNotMatch(prompt, /OBLIGATORIAMENTE/);
});

test('EvaluatorRole.run: delega en evaluateMultiJudge y devuelve report', async () => {
  const registry = new AdapterRegistry();
  registry.register('j1', adapterReturning({ score: 0.8 }));
  registry.register('j2', adapterReturning({ score: 0.85 }));
  const role = new EvaluatorRole({
    name: 'eval',
    logger: silentLogger(),
    registry,
    providers: ['j1', 'j2'],
  });
  const report = await role.run(
    { query: 'q', answer: 'a' },
    { get: () => null, has: () => false },
  );
  assert.ok(report.aggregateScore > 0.8);
  assert.equal(report.verdicts.length, 2);
});

test('EvaluatorRole.run: deriva context de contextChunks si no se pasa explícito', async () => {
  let capturedContext = null;
  const registry = new AdapterRegistry();
  registry.register('j1', async (prompt) => {
    capturedContext = prompt;
    return {
      provider: 'j1',
      process: { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false },
      parsedOutput: { format: 'json', json: { score: 0.9 }, text: '' },
    };
  });
  const role = new EvaluatorRole({
    name: 'eval',
    logger: silentLogger(),
    registry,
    providers: ['j1'],
  });
  await role.run(
    {
      query: 'q',
      answer: 'a',
      contextChunks: [
        { metadata: { content: 'chunk-uno' } },
        { metadata: { content: 'chunk-dos' } },
      ],
    },
    { get: () => null, has: () => false },
  );
  assert.match(capturedContext, /chunk-uno/);
  assert.match(capturedContext, /chunk-dos/);
});

test('EvaluatorRole: valida args en constructor', () => {
  const registry = new AdapterRegistry();
  assert.throws(
    // @ts-expect-error missing providers
    () => new EvaluatorRole({ name: 'e', logger: silentLogger(), registry }),
    /providers/,
  );
  assert.throws(
    // @ts-expect-error missing registry
    () => new EvaluatorRole({ name: 'e', logger: silentLogger(), providers: ['x'] }),
    /registry/,
  );
});

test('EvaluatorRole.run: valida input', async () => {
  const registry = new AdapterRegistry();
  registry.register('j', adapterReturning({ score: 0.5 }));
  const role = new EvaluatorRole({
    name: 'eval',
    logger: silentLogger(),
    registry,
    providers: ['j'],
  });
  await assert.rejects(
    // @ts-expect-error missing answer
    () => role.run({ query: 'q' }, { get: () => null, has: () => false }),
    /query e input\.answer/,
  );
});
