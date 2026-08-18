// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySensitivity,
  isSensitivityAllowed,
  SENSITIVITY_LEVELS,
  DEFAULT_SENSITIVITY,
} from '../src/domain/document.js';

test('classifySensitivity: devuelve "public" si metadata lo declara', () => {
  const doc = { id: 'd1', content: 'x', metadata: { sensitivity: 'public' } };
  assert.equal(classifySensitivity(doc), 'public');
});

test('classifySensitivity: devuelve "internal" si metadata lo declara', () => {
  const doc = { id: 'd1', content: 'x', metadata: { sensitivity: 'internal' } };
  assert.equal(classifySensitivity(doc), 'internal');
});

test('classifySensitivity: devuelve "confidential" si metadata lo declara', () => {
  const doc = { id: 'd1', content: 'x', metadata: { sensitivity: 'confidential' } };
  assert.equal(classifySensitivity(doc), 'confidential');
});

test('classifySensitivity: default cuando no hay metadata.sensitivity', () => {
  const doc = { id: 'd1', content: 'x', metadata: { source: 'note.md' } };
  assert.equal(classifySensitivity(doc), DEFAULT_SENSITIVITY);
  assert.equal(DEFAULT_SENSITIVITY, 'internal');
});

test('classifySensitivity: default cuando metadata.sensitivity es inválido', () => {
  const doc = {
    id: 'd1',
    content: 'x',
    // @ts-expect-error valor deliberadamente fuera del enum
    metadata: { sensitivity: 'ultra-top-secret' },
  };
  assert.equal(classifySensitivity(doc), DEFAULT_SENSITIVITY);
});

test('classifySensitivity: default si doc o metadata faltan', () => {
  // @ts-expect-error input parcial
  assert.equal(classifySensitivity(null), DEFAULT_SENSITIVITY);
  // @ts-expect-error input parcial
  assert.equal(classifySensitivity({}), DEFAULT_SENSITIVITY);
});

test('classifySensitivity: funciona también sobre un Chunk', () => {
  const chunk = {
    id: 'd1#0',
    documentId: 'd1',
    content: 'hola',
    metadata: { sensitivity: 'confidential' },
  };
  assert.equal(classifySensitivity(chunk), 'confidential');
});

test('isSensitivityAllowed: respeta la lista de niveles permitidos', () => {
  assert.equal(isSensitivityAllowed('public', ['public']), true);
  assert.equal(isSensitivityAllowed('confidential', ['public', 'internal']), false);
  assert.equal(isSensitivityAllowed('internal', SENSITIVITY_LEVELS), true);
});

test('SENSITIVITY_LEVELS: contiene los 3 niveles esperados y está congelado', () => {
  assert.deepEqual([...SENSITIVITY_LEVELS], ['public', 'internal', 'confidential']);
  assert.throws(() => {
    // @ts-expect-error mutación intencional
    SENSITIVITY_LEVELS.push('other');
  });
});
