// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliOutput } from '../src/ai/output-parser.js';

test('parseCliOutput: parsea un JSON puro como objeto', () => {
  const stdout = '{"answer":"hola","n":1}';
  const result = parseCliOutput(stdout, '');
  assert.equal(result.format, 'json');
  assert.deepEqual(result.json, { answer: 'hola', n: 1 });
  assert.equal(result.text, stdout);
});

test('parseCliOutput: parsea un JSON puro como array', () => {
  const stdout = '[1,2,3]';
  const result = parseCliOutput(stdout, '');
  assert.equal(result.format, 'json');
  assert.deepEqual(result.json, [1, 2, 3]);
});

test('parseCliOutput: hace fallback a texto plano cuando no hay JSON', () => {
  const stdout = 'Esto es solo una frase sin JSON';
  const result = parseCliOutput(stdout, '');
  assert.equal(result.format, 'text');
  assert.equal(result.json, null);
  assert.equal(result.text, 'Esto es solo una frase sin JSON');
});

test('parseCliOutput: combina stdout y stderr en fallback de texto', () => {
  const result = parseCliOutput('linea stdout', 'aviso stderr');
  assert.equal(result.format, 'text');
  assert.ok(result.text.includes('linea stdout'));
  assert.ok(result.text.includes('aviso stderr'));
});

test('parseCliOutput: extrae JSON embebido dentro de texto ruidoso', () => {
  const stdout = 'Aquí tienes el resultado:\n{"answer":"ok","details":"todo bien"}\nFin del log.';
  const result = parseCliOutput(stdout, '');
  assert.equal(result.format, 'json');
  assert.deepEqual(result.json, { answer: 'ok', details: 'todo bien' });
});

test('parseCliOutput: extrae JSON embebido con estructuras anidadas', () => {
  const stdout =
    'DEBUG: start\nrespuesta => {"a":1,"b":{"c":[1,2,3],"d":"texto con } llave"}}\nDEBUG: end';
  const result = parseCliOutput(stdout, '');
  assert.equal(result.format, 'json');
  assert.deepEqual(result.json, {
    a: 1,
    b: { c: [1, 2, 3], d: 'texto con } llave' },
  });
});

test('parseCliOutput: devuelve formato vacío cuando no hay nada', () => {
  const result = parseCliOutput('', '');
  assert.equal(result.format, 'empty');
  assert.equal(result.json, null);
  assert.equal(result.text, '');
});

test('parseCliOutput: tolera entradas no-string sin romper', () => {
  // @ts-expect-error probamos robustez ante tipos incorrectos
  const result = parseCliOutput(undefined, null);
  assert.equal(result.format, 'empty');
  assert.equal(result.json, null);
  assert.equal(result.text, '');
});

test('parseCliOutput: JSON inválido cae a texto plano', () => {
  const stdout = '{"answer": "sin cerrar"';
  const result = parseCliOutput(stdout, '');
  assert.equal(result.format, 'text');
  assert.equal(result.json, null);
  assert.ok(result.text.includes('sin cerrar'));
});
