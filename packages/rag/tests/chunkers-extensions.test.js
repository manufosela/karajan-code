// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateTokens,
  chunkByTokens,
  chunkByHeadings,
} from '../src/ingestion/chunkers.js';

test('estimateTokens: heurística length/4 con redondeo hacia arriba', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(estimateTokens('x'.repeat(400)), 100);
});

test('estimateTokens: acepta null/undefined sin romper', () => {
  // @ts-expect-error
  assert.equal(estimateTokens(null), 0);
  // @ts-expect-error
  assert.equal(estimateTokens(undefined), 0);
});

test('chunkByTokens: maxTokens=100 produce chunks de ~400 chars', () => {
  const doc = { id: 'd', content: 'x'.repeat(2000), metadata: {} };
  const chunks = chunkByTokens(doc, { maxTokens: 100 });
  for (const c of chunks) {
    assert.ok(c.content.length <= 400, `chunk len ${c.content.length}`);
  }
  assert.equal(chunks[0].metadata.tokens, 100);
});

test('chunkByTokens: overlapTokens respetado', () => {
  const doc = { id: 'd', content: 'x'.repeat(1000), metadata: {} };
  const chunks = chunkByTokens(doc, { maxTokens: 100, overlapTokens: 20 });
  // step = 100-20 = 80 tokens = 320 chars
  assert.equal(chunks[1].metadata.offset, 320);
});

test('chunkByTokens: valida args', () => {
  const doc = { id: 'd', content: 'x', metadata: {} };
  assert.throws(() => chunkByTokens(doc, { maxTokens: 0 }), /maxTokens/);
  assert.throws(() => chunkByTokens(doc, { maxTokens: 10, overlapTokens: 10 }), /overlapTokens/);
});

test('chunkByHeadings: trocea por # respetando la jerarquía', () => {
  const content = [
    '# Intro',
    'Texto intro.',
    '',
    '## Sección A',
    'Contenido A.',
    '',
    '## Sección B',
    'Contenido B.',
    '',
    '### Sub B1',
    'Detalle B1.',
  ].join('\n');
  const doc = { id: 'd', content, metadata: {} };
  const chunks = chunkByHeadings(doc, { levels: [1, 2, 3], maxSize: 1000 });
  assert.ok(chunks.length >= 4);
  assert.equal(chunks[0].metadata.heading, 'Intro');
  const sectionA = chunks.find((c) => c.metadata.heading?.includes('Sección A'));
  const sectionB = chunks.find((c) => c.metadata.heading?.includes('Sección B'));
  const subB1 = chunks.find((c) => c.metadata.heading?.includes('Sub B1'));
  assert.ok(sectionA);
  assert.ok(sectionB);
  assert.ok(subB1);
  assert.equal(subB1.metadata.heading, 'Intro > Sección B > Sub B1');
});

test('chunkByHeadings: secciones grandes se re-trocean con separators', () => {
  const big = 'A'.repeat(3000);
  const content = `# Título\n\n${big}`;
  const doc = { id: 'd', content, metadata: {} };
  const chunks = chunkByHeadings(doc, { levels: [1], maxSize: 800 });
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.content.length <= 800);
    assert.equal(c.metadata.heading, 'Título');
  }
});

test('chunkByHeadings: ignora niveles no configurados', () => {
  const content = [
    '# L1',
    'Contenido L1.',
    '',
    '## L2 (ignorado)',
    'Texto que se une al L1 porque L2 no está en levels.',
  ].join('\n');
  const doc = { id: 'd', content, metadata: {} };
  const chunks = chunkByHeadings(doc, { levels: [1], maxSize: 1000 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].metadata.heading, 'L1');
  assert.ok(chunks[0].content.includes('L2 (ignorado)'));
});

test('chunkByHeadings: contenido antes del primer heading queda con heading null', () => {
  const content = 'Preámbulo sin heading.\n\n# Primero\nTras.';
  const doc = { id: 'd', content, metadata: {} };
  const chunks = chunkByHeadings(doc, { levels: [1, 2], maxSize: 1000 });
  assert.equal(chunks[0].metadata.heading, null);
  assert.ok(chunks[0].content.includes('Preámbulo'));
  assert.equal(chunks[1].metadata.heading, 'Primero');
});

test('chunkByHeadings: valida maxSize', () => {
  const doc = { id: 'd', content: 'x', metadata: {} };
  assert.throws(() => chunkByHeadings(doc, { maxSize: 0 }), /maxSize/);
});
