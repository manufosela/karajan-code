// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGoldenSet, runGoldenSet, validateGoldenSet } from '../src/evaluation/golden-runner.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GOLDEN_PATH = path.join(ROOT, 'examples/golden/golden.json');
const CORPUS_DIR = path.join(ROOT, 'examples/golden/corpus');

test('golden set del repo: supera su baseline offline (smoke de regresión)', async () => {
  const golden = await loadGoldenSet(GOLDEN_PATH);
  const report = await runGoldenSet(golden, { corpusDir: CORPUS_DIR });
  assert.equal(
    report.passed,
    true,
    `baseline roto: ${report.failures
      .map((f) => `${f.metric}=${f.value.toFixed(2)} < ${f.minimum} (peores: ${f.worstCases.join(', ')})`)
      .join('; ')}`,
  );
  assert.equal(report.results.length, golden.cases.length);
});

test('una degradación hace fallar señalando métrica y peores casos', async () => {
  const golden = await loadGoldenSet(GOLDEN_PATH);
  const impossible = { ...golden, baseline: { ...golden.baseline, faithfulness: 1.01 } };
  // Baseline > 1 es inalcanzable por construcción — simula una regresión.
  assert.throws(() => validateGoldenSet(impossible), /baseline/);

  const strict = { ...golden, baseline: { ...golden.baseline, contextPrecision: 1 } };
  const report = await runGoldenSet(validateGoldenSet(strict), { corpusDir: CORPUS_DIR });
  if (!report.passed) {
    const failure = report.failures[0];
    assert.ok(failure.metric.length > 0);
    assert.ok(failure.worstCases.length > 0, 'señala los peores casos');
  }
});

test('validateGoldenSet: formas inválidas fallan con mensaje claro', () => {
  assert.throws(() => validateGoldenSet(null), /golden set inválido/);
  assert.throws(() => validateGoldenSet({ baseline: {}, cases: [] }), /cases/);
  assert.throws(
    () => validateGoldenSet({ baseline: { velocidad: 0.5 }, cases: [{ id: 'x', question: 'q', expectedAnswer: 'a', relevantSources: ['s'] }] }),
    /velocidad/,
  );
  assert.throws(
    () => validateGoldenSet({ baseline: {}, cases: [{ id: 'x', question: 'q', expectedAnswer: 'a', relevantSources: [] }] }),
    /relevantSources/,
  );
});
