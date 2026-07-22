// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { deprecate, resetDeprecationWarnings } from '../src/deprecation.js';

test('deprecate: emite DeprecationWarning una sola vez por símbolo', async () => {
  resetDeprecationWarnings();
  const warningPromise = once(process, 'warning');
  const first = deprecate('simboloDemo', {
    since: '1.2.0',
    removal: '1.4.0',
    alternative: 'nuevoSimbolo()',
  });
  const [warning] = await warningPromise;
  assert.equal(first, true);
  assert.equal(/** @type {any} */ (warning).name, 'DeprecationWarning');
  assert.match(warning.message, /simboloDemo.*1\.2\.0.*1\.4\.0.*nuevoSimbolo/s);
  assert.equal(/** @type {any} */ (warning).code, 'KJR_DEPRECATED_simboloDemo');

  assert.equal(deprecate('simboloDemo', { since: '1.2.0', removal: '1.4.0' }), false, 'segunda llamada silenciosa');
});

test('deprecate: sin alternativa el mensaje omite la sugerencia', async () => {
  resetDeprecationWarnings();
  const warningPromise = once(process, 'warning');
  deprecate('otroSimbolo', { since: '1.0.0', removal: '1.2.0' });
  const [warning] = await warningPromise;
  assert.ok(!warning.message.includes('en su lugar'));
});

test('deprecate: valida argumentos', () => {
  assert.throws(() => deprecate('', { since: '1.0.0', removal: '1.2.0' }), /name/);
  assert.throws(() => deprecate('x', /** @type {never} */ ({ since: '1.0.0' })), /removal/);
});
