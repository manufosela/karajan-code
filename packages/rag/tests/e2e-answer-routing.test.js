// @ts-check
/**
 * KJR-TSK-0136 (3/3) — recomendación post-1.0 de la pasada 3: test
 * END-TO-END del routing final de `query --answer` con store REAL
 * (LanceDB), no solo queryIndex. Cubre el camino completo del CLI:
 * openEasyIndex → retrieval híbrido → nivel efectivo → policy →
 * redacción → adapter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runIndexCommand, runQueryCommand } from '../src/easy/cli.js';

/** @returns {Promise<string>} corpus indexado con lancedb real */
async function makeLanceCorpus() {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-e2e-'));
  await writeFile(
    path.join(root, 'sesiones.md'),
    '# Sesiones\nEl token de sesion se valida en el middleware de auth. Contacto del equipo: equipo@example.com\n',
    'utf8',
  );
  await writeFile(path.join(root, 'facturas.md'), '# Facturas\nLa tarifa base incluye impuestos.\n', 'utf8');
  await runIndexCommand([root], { env: {}, log: () => {} });
  return root;
}

test('e2e --answer: routing completo con LanceDB real — policy, redacción y hits', async () => {
  const root = await makeLanceCorpus();
  try {
    /** @type {string[]} */
    const prompts = [];
    const registry = {
      has: (/** @type {string} */ name) => name === 'ollama',
      get: () => async (/** @type {string} */ prompt) => {
        prompts.push(prompt);
        return { parsedOutput: { text: 'respuesta e2e' } };
      },
    };
    /** @type {string[]} */
    const outs = [];
    /** @type {string[]} */
    const logs = [];

    const result = await runQueryCommand(
      ['donde se valida el token de sesion', root, '--answer'],
      { env: {}, adapterRegistry: registry, out: (m) => outs.push(m), log: (m) => logs.push(m) },
    );

    // Respuesta por el adapter que decidió la POLICY (default claude no
    // permitido para internal → ollama), con el nivel visible.
    assert.equal(result.answer, 'respuesta e2e');
    assert.ok(outs.some((l) => l.includes('ollama') && l.includes('internal')), 'la salida muestra adapter y nivel');
    assert.ok(logs.some((l) => l.includes('claude') && l.includes('ollama')), 'el log avisa del enrutado por policy');

    // Hits reales del store con formato fichero:línea y score.
    assert.ok(
      outs.some((l) => /sesiones\.md:\d+ \(score /.test(l)),
      'hit del fichero relevante con línea y score reales',
    );

    // El contenido del corpus viaja al adapter con la PII redactada.
    assert.equal(prompts.length, 1);
    assert.ok(prompts[0].includes('middleware de auth'), 'contexto real en el prompt');
    assert.ok(!prompts[0].includes('equipo@example.com'), 'la PII no viaja');
    assert.ok(prompts[0].includes('[REDACTED_EMAIL]'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('e2e --answer: adapter explícito no permitido → rechazo del gate con LanceDB real', async () => {
  const root = await makeLanceCorpus();
  try {
    await assert.rejects(
      () => runQueryCommand(
        ['tarifa base', root, '--answer', '--adapter', 'claude'],
        { env: {}, adapterRegistry: { has: () => true, get: () => async () => ({}) }, out: () => {}, log: () => {} },
      ),
      /internal/,
      'elección explícita no permitida → error del gate, nunca degradación',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
