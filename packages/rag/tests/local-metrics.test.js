// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  faithfulness,
  contextPrecision,
  contextRecall,
  answerRelevance,
  evaluateAnswer,
} from '../src/evaluation/local-metrics.js';

const CONTEXTS = [
  'La facturación mensual se emite el día 1 de cada mes.',
  'Los pedidos se entregan en un plazo de 48 horas.',
];

test('faithfulness: respuesta totalmente fundamentada → 1', () => {
  assert.equal(faithfulness('La facturación se emite el día 1.', CONTEXTS), 1);
});

test('faithfulness: alucinación total → 0', () => {
  const score = faithfulness('Los unicornios galopan bajo cascadas violetas.', CONTEXTS);
  assert.equal(score, 0);
});

test('faithfulness: respuesta parcialmente fundamentada → intermedio', () => {
  const score = faithfulness('La facturación se emite cantando jotas.', CONTEXTS);
  assert.ok(score > 0 && score < 1, `esperado intermedio, fue ${score}`);
});

test('faithfulness: degenerados definidos — vacíos → 0', () => {
  assert.equal(faithfulness('', CONTEXTS), 0);
  assert.equal(faithfulness('respuesta', []), 0);
  assert.equal(faithfulness('respuesta', ['']), 0);
});

test('contextPrecision: proporción de recuperados que son relevantes', () => {
  assert.equal(contextPrecision(['a', 'b'], ['a', 'b']), 1);
  assert.equal(contextPrecision(['a', 'b', 'c', 'd'], ['a', 'b']), 0.5);
  assert.equal(contextPrecision(['x', 'y'], ['a']), 0);
  assert.equal(contextPrecision([], ['a']), 0);
});

test('contextRecall: proporción de relevantes que fueron recuperados', () => {
  assert.equal(contextRecall(['a', 'b', 'x'], ['a', 'b']), 1);
  assert.equal(contextRecall(['a'], ['a', 'b']), 0.5);
  assert.equal(contextRecall([], ['a', 'b']), 0);
});

test('contextRecall: sin relevantes declarados → error explícito', () => {
  assert.throws(() => contextRecall(['a'], []), /relevantIds/);
});

test('answerRelevance: cobertura de la pregunta en la respuesta', () => {
  assert.equal(
    answerRelevance('¿Cuándo se emite la facturación mensual?', 'La facturación mensual se emite el día 1.'),
    1,
  );
  const partial = answerRelevance('¿Cuándo se emite la facturación?', 'Se emite pronto.');
  assert.ok(partial > 0 && partial < 1);
  assert.equal(answerRelevance('¿Cuándo facturamos?', 'Los pájaros vuelan bajo.'), 0);
  assert.equal(answerRelevance('¿Cuándo?', ''), 0);
});

test('answerRelevance: los duplicados no inflan la cobertura', () => {
  const once = answerRelevance('¿Cuándo se emite la facturación?', 'La facturación se emite.');
  const spam = answerRelevance('¿Cuándo se emite la facturación?', 'facturación facturación facturación');
  assert.ok(once > spam, 'repetir un token no debe superar cubrir más tokens distintos');
});

test('evaluateAnswer: agrega las cuatro métricas', () => {
  const report = evaluateAnswer({
    question: '¿Cuándo se emite la facturación mensual?',
    answer: 'La facturación mensual se emite el día 1.',
    contexts: CONTEXTS,
    retrievedIds: ['doc:faq.md#0', 'doc:otros.md#3'],
    relevantIds: ['doc:faq.md#0'],
  });
  assert.equal(report.faithfulness, 1);
  assert.equal(report.contextPrecision, 0.5);
  assert.equal(report.contextRecall, 1);
  assert.equal(report.answerRelevance, 1);
  for (const value of Object.values(report)) {
    assert.ok(value >= 0 && value <= 1 && !Number.isNaN(value));
  }
});

test('evaluateAnswer: sin ids es opcional — solo métricas de texto', () => {
  const report = evaluateAnswer({
    question: '¿Plazo de entrega?',
    answer: 'Los pedidos se entregan en 48 horas.',
    contexts: CONTEXTS,
  });
  assert.ok(report.faithfulness > 0.5);
  assert.equal(report.contextPrecision, null);
  assert.equal(report.contextRecall, null);
});
