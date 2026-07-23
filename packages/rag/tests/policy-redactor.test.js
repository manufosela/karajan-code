// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultSensitivityPolicy,
  validateSensitivityPolicy,
  resolveAdapterFor,
  isProviderAllowed,
} from '../src/policy/sensitivity-policy.js';
import { redactPII } from '../src/redaction/pii-redactor.js';

test('createDefaultSensitivityPolicy: expone claves public/internal/confidential', () => {
  const p = createDefaultSensitivityPolicy();
  assert.ok(Array.isArray(p.public));
  assert.ok(Array.isArray(p.internal));
  assert.ok(Array.isArray(p.confidential));
  assert.ok(p.confidential.includes('ollama'));
  assert.ok(!p.confidential.includes('claude'));
});

test('validateSensitivityPolicy: acepta policy correcta', () => {
  const p = validateSensitivityPolicy({
    confidential: ['ollama'],
    internal: ['ollama', 'azure'],
    public: ['claude'],
  });
  assert.deepEqual(p.confidential, ['ollama']);
});

test('validateSensitivityPolicy: rechaza policies malformadas', () => {
  assert.throws(() => validateSensitivityPolicy(null), /objeto/);
  assert.throws(
    () => validateSensitivityPolicy({ confidential: [] }),
    /internal|public/,
  );
  assert.throws(
    () =>
      validateSensitivityPolicy({
        confidential: ['ollama'],
        internal: ['x'],
        public: [123],
      }),
    /providers/,
  );
});

test('resolveAdapterFor: respeta preferred si está permitido', () => {
  const policy = createDefaultSensitivityPolicy();
  assert.equal(resolveAdapterFor({ policy, sensitivity: 'public', preferred: 'gemini' }), 'gemini');
});

test('resolveAdapterFor: si preferred no está permitido usa el primero de la lista', () => {
  const policy = createDefaultSensitivityPolicy();
  // 'claude' no está permitido para confidential — debe fallback a 'ollama'.
  assert.equal(
    resolveAdapterFor({ policy, sensitivity: 'confidential', preferred: 'claude' }),
    'ollama',
  );
});

test('resolveAdapterFor: sin preferred usa el primero', () => {
  const policy = createDefaultSensitivityPolicy();
  assert.equal(resolveAdapterFor({ policy, sensitivity: 'public' }), 'claude');
});

test('resolveAdapterFor: nivel sin providers lanza', () => {
  const policy = {
    confidential: /** @type {string[]} */ ([]),
    internal: ['ollama'],
    public: ['claude'],
  };
  assert.throws(
    () => resolveAdapterFor({ policy, sensitivity: 'confidential' }),
    /no hay providers/,
  );
});

test('isProviderAllowed: respeta la lista del nivel', () => {
  const policy = createDefaultSensitivityPolicy();
  assert.equal(isProviderAllowed(policy, 'confidential', 'ollama'), true);
  assert.equal(isProviderAllowed(policy, 'confidential', 'claude'), false);
  assert.equal(isProviderAllowed(policy, 'public', 'claude'), true);
});

test('redactPII: elimina email', () => {
  const { text, counts, total } = redactPII('contáctame en user@example.com hoy');
  assert.ok(text.includes('[REDACTED_EMAIL]'));
  assert.equal(counts.email, 1);
  assert.equal(total, 1);
});

test('redactPII: elimina tarjeta de crédito', () => {
  const { text, counts } = redactPII('Mi tarjeta 4111 1111 1111 1111 vence pronto');
  assert.ok(text.includes('[REDACTED_CARD]'));
  assert.equal(counts.creditCard, 1);
});

test('redactPII: elimina IBAN español (con y sin espacios)', () => {
  const compact = redactPII('Transferir a ES9121000418450200051332 antes del día 5.');
  assert.ok(compact.text.includes('[REDACTED_IBAN]'));
  assert.ok(!compact.text.includes('ES9121000418450200051332'));
  assert.equal(compact.counts.iban, 1);

  const spaced = redactPII('IBAN: ES91 2100 0418 4502 0005 1332');
  assert.ok(spaced.text.includes('[REDACTED_IBAN]'));
  assert.ok(!spaced.text.includes('0005 1332'));
  assert.equal(spaced.counts.iban, 1);
});

test('redactPII: elimina IBAN internacional', () => {
  const { text, counts } = redactPII('Cuenta alemana DE89370400440532013000 activa.');
  assert.ok(text.includes('[REDACTED_IBAN]'));
  assert.equal(counts.iban, 1);
});

test('redactPII: un IBAN no se confunde con tarjeta ni teléfono', () => {
  const { counts } = redactPII('Pagar al IBAN ES9121000418450200051332.');
  assert.equal(counts.iban, 1);
  assert.equal(counts.creditCard, 0);
  assert.equal(counts.phone, 0);
});

test('redactPII: elimina NIF español', () => {
  const { text, counts } = redactPII('El NIF es 12345678Z.');
  assert.ok(text.includes('[REDACTED_ID]'));
  assert.equal(counts.nif, 1);
});

test('redactPII: elimina NIE español', () => {
  const { text, counts } = redactPII('NIE: X1234567L');
  assert.ok(text.includes('[REDACTED_ID]'));
  assert.equal(counts.nie, 1);
});

test('redactPII: combina múltiples tipos y cuenta total', () => {
  const { text, total, counts } = redactPII(
    'Email a@b.com, tel +34 600 123 456, NIF 12345678Z',
  );
  assert.equal(counts.email, 1);
  assert.ok(counts.phone >= 1);
  assert.equal(counts.nif, 1);
  assert.ok(total >= 3);
  assert.ok(!text.includes('a@b.com'));
  assert.ok(!text.includes('12345678Z'));
});

test('redactPII: no se evade con Unicode fullwidth ni espacios exóticos (KJR-BUG-0009)', () => {
  // Arroba fullwidth (U+FF20) — NFKC la normaliza a @.
  const fullwidth = redactPII('escribe a cliente＠empresa.com ya');
  assert.ok(!fullwidth.text.includes('empresa.com'), 'el email ofuscado no sobrevive');
  assert.equal(fullwidth.counts.email, 1);

  // IBAN con thin space (U+2009) y narrow no-break space (U+202F).
  const iban = redactPII('IBAN: ES91 2100 0418 4502 0005 1332');
  assert.equal(iban.counts.iban, 1);
  assert.ok(iban.text.includes('[REDACTED_IBAN]'));

  // No-break space (U+00A0) en un teléfono.
  const phone = redactPII('llama al +34 600 123 456');
  assert.ok(phone.counts.phone >= 1);
});

test('redactPII: NIF/NIE con separadores también caen (KJR-BUG-0009)', () => {
  const nif = redactPII('El NIF es 12345678-Z.');
  assert.equal(nif.counts.nif, 1);
  assert.ok(!nif.text.includes('12345678'));

  const nie = redactPII('NIE X-1234567-L registrado');
  assert.equal(nie.counts.nie, 1);
  assert.ok(!nie.text.includes('1234567'));
});

test('redactPII: texto sin PII queda igual y total 0', () => {
  const { text, total, counts } = redactPII('Hola mundo sin datos sensibles.');
  assert.equal(text, 'Hola mundo sin datos sensibles.');
  assert.equal(total, 0);
  assert.equal(counts.email, 0);
});

test('redactPII: lanza si input no es string', () => {
  // @ts-expect-error wrong type
  assert.throws(() => redactPII(123), /string/);
});
