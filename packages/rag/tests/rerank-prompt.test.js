// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRerankPrompt,
  RERANK_PROMPT_VERSION,
  RERANK_SNIPPET_MAX_CHARS,
} from '../src/retrieval/rerank-prompt.js';

/**
 * SNAPSHOT del template v1 — congela la redacción exacta del prompt.
 * Si este test falla es que alguien cambió el prompt: actualizar el
 * snapshot Y subir RERANK_PROMPT_VERSION conscientemente en el mismo PR.
 */
const SNAPSHOT_V1 = [
  'Eres un reranker. Reordena los siguientes fragmentos por relevancia para la query.',
  'Query: ¿plazo de entrega?',
  '',
  'Fragmentos:',
  '1. id=doc:envios.md#0',
  'Los pedidos se entregan en 48 horas.',
  '---',
  '2. id=doc:faq.md#2',
  'El plazo puede variar en islas.',
  '',
  'Responde EXCLUSIVAMENTE con un JSON: { "ranking": ["id1","id2",...] }.',
].join('\n');

test('snapshot v1: la redacción del prompt está congelada', () => {
  assert.equal(RERANK_PROMPT_VERSION, 1, 'si cambias el prompt, sube la versión y este snapshot');
  const prompt = buildRerankPrompt('¿plazo de entrega?', [
    { id: 'doc:envios.md#0', metadata: { content: 'Los pedidos se entregan en 48 horas.' } },
    { id: 'doc:faq.md#2', metadata: { content: 'El plazo puede variar en islas.' } },
  ]);
  assert.equal(prompt, SNAPSHOT_V1);
});

test('los snippets se truncan al máximo declarado', () => {
  const long = 'x'.repeat(RERANK_SNIPPET_MAX_CHARS * 2);
  const prompt = buildRerankPrompt('q', [{ id: 'a', metadata: { content: long } }]);
  const snippet = /** @type {string} */ (prompt.split('id=a\n')[1]).split('\n')[0];
  assert.equal(snippet.length, RERANK_SNIPPET_MAX_CHARS);
});

test('metadata sin content produce snippet vacío, no "undefined"', () => {
  const prompt = buildRerankPrompt('q', [{ id: 'a' }]);
  assert.ok(!prompt.includes('undefined'));
  assert.ok(prompt.includes('1. id=a'));
});

test('valida entradas: query vacía o hits vacíos fallan', () => {
  assert.throws(() => buildRerankPrompt('', [{ id: 'a' }]), /query/);
  assert.throws(() => buildRerankPrompt('q', []), /hits/);
});
