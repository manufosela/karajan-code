// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deprecate, resetDeprecationWarnings } from '../src/deprecation.js';

/**
 * Espera el warning con el código dado — inmune a avisos de otros tests
 * que corren en paralelo sobre el mismo process.
 *
 * @param {string} code
 * @returns {Promise<Error & { code?: string }>}
 */
function waitForWarning(code) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.off('warning', onWarning);
      reject(new Error(`warning ${code} no llegó`));
    }, 2000);
    /** @param {Error & { code?: string }} warning */
    function onWarning(warning) {
      if (warning.code === code) {
        clearTimeout(timer);
        process.off('warning', onWarning);
        resolve(warning);
      }
    }
    process.on('warning', onWarning);
  });
}

test('deprecate: emite DeprecationWarning una sola vez por símbolo', async () => {
  resetDeprecationWarnings();
  const warningPromise = waitForWarning('KJR_DEPRECATED_simboloDemo');
  const first = deprecate('simboloDemo', {
    since: '1.2.0',
    removal: '1.4.0',
    alternative: 'nuevoSimbolo()',
  });
  const warning = await warningPromise;
  assert.equal(first, true);
  assert.equal(warning.name, 'DeprecationWarning');
  assert.match(warning.message, /simboloDemo.*1\.2\.0.*1\.4\.0.*nuevoSimbolo/s);

  assert.equal(deprecate('simboloDemo', { since: '1.2.0', removal: '1.4.0' }), false, 'segunda llamada silenciosa');
});

test('deprecate: sin alternativa el mensaje omite la sugerencia', async () => {
  resetDeprecationWarnings();
  const warningPromise = waitForWarning('KJR_DEPRECATED_otroSimbolo');
  deprecate('otroSimbolo', { since: '1.0.0', removal: '1.2.0' });
  const warning = await warningPromise;
  assert.ok(!warning.message.includes('en su lugar'));
});

test('deprecate: valida argumentos', () => {
  assert.throws(() => deprecate('', { since: '1.0.0', removal: '1.2.0' }), /name/);
  assert.throws(() => deprecate('x', /** @type {never} */ ({ since: '1.0.0' })), /removal/);
});
