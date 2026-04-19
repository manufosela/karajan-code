// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateSize } from '../src/pipeline/pipeline.js';

test('estimateSize: null/undefined → 0', () => {
  assert.equal(estimateSize(null), 0);
  assert.equal(estimateSize(undefined), 0);
});

test('estimateSize: arrays → length', () => {
  assert.equal(estimateSize([]), 0);
  assert.equal(estimateSize([1, 2, 3]), 3);
});

test('estimateSize: strings → length', () => {
  assert.equal(estimateSize(''), 0);
  assert.equal(estimateSize('hola'), 4);
});

test('estimateSize: number/boolean → 1', () => {
  assert.equal(estimateSize(42), 1);
  assert.equal(estimateSize(0), 1);
  assert.equal(estimateSize(true), 1);
});

test('estimateSize: object → keys length', () => {
  assert.equal(estimateSize({}), 0);
  assert.equal(estimateSize({ a: 1, b: 2 }), 2);
});

test('estimateSize: ArrayBuffer y TypedArray → byteLength', () => {
  const buf = new ArrayBuffer(8);
  assert.equal(estimateSize(buf), 8);
  const view = new Uint8Array(16);
  assert.equal(estimateSize(view), 16);
});

test('estimateSize: function → undefined', () => {
  assert.equal(estimateSize(() => 1), undefined);
});
