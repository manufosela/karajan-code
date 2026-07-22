// @ts-check
/**
 * Mitigación KJR-BUG-0006: lo que sale de la capa easy hacia un LLM va
 * redactado de PII (defensa en profundidad hasta el routing completo).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runEvalCommand } from '../src/easy/cli.js';

test('eval --judges: la PII del golden no llega a los jueces', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-sens-'));
  try {
    await mkdir(path.join(root, 'corpus'), { recursive: true });
    await writeFile(
      path.join(root, 'corpus', 'clientes.md'),
      '# Clientes\nEl contacto de facturación es privado.\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'golden.json'),
      JSON.stringify({
        topK: 1,
        baseline: { answerRelevance: 0 },
        cases: [
          {
            id: 'con-pii',
            question: '¿Cuál es el email de contacto?',
            expectedAnswer: 'El contacto es cliente.secreto@empresa.com y su NIF 12345678Z.',
            relevantSources: ['clientes.md'],
          },
        ],
      }),
      'utf8',
    );

    /** @type {string[]} */
    const promptsEnviados = [];
    const registry = {
      has: () => true,
      get: () => async (/** @type {string} */ prompt) => {
        promptsEnviados.push(prompt);
        return { parsedOutput: { json: { score: 0.9, rationale: 'ok' } } };
      },
    };

    await runEvalCommand([path.join(root, 'golden.json'), '--judges', 'j1'], {
      out: () => {},
      judgeRegistry: registry,
    });

    assert.equal(promptsEnviados.length, 1);
    const prompt = promptsEnviados[0];
    assert.ok(!prompt.includes('cliente.secreto@empresa.com'), 'el email no viaja al juez');
    assert.ok(!prompt.includes('12345678Z'), 'el NIF no viaja al juez');
    assert.ok(prompt.includes('[REDACTED_EMAIL]'), 'placeholder de email presente');
    assert.ok(prompt.includes('[REDACTED_ID]'), 'placeholder de NIF presente');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
