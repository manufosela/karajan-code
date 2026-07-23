// @ts-check
/**
 * KJR-BUG-0006 (parte 2): la capa easy aplica la sensitivity policy en
 * todas las salidas hacia LLMs — `query --answer` enruta por el nivel
 * efectivo de los chunks recuperados y `eval --judges` rechaza jueces
 * no permitidos para el nivel declarado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { enforceEasyAdapterPolicy } from '../src/easy/sensitivity.js';
import {
  parseQueryArgs,
  parseEvalArgs,
  generateAnswerForHits,
  runEvalCommand,
} from '../src/easy/cli.js';

test('enforceEasyAdapterPolicy: adapter permitido pasa sin cambios', () => {
  assert.equal(
    enforceEasyAdapterPolicy({ sensitivity: 'public', adapter: 'claude', explicit: true }),
    'claude',
  );
  assert.equal(
    enforceEasyAdapterPolicy({ sensitivity: 'confidential', adapter: 'ollama', explicit: false }),
    'ollama',
  );
});

test('enforceEasyAdapterPolicy: flag explícito no permitido → error accionable', () => {
  assert.throws(
    () => enforceEasyAdapterPolicy({ sensitivity: 'internal', adapter: 'claude', explicit: true }),
    (err) => {
      const msg = /** @type {Error} */ (err).message;
      assert.ok(msg.includes('internal'), 'menciona el nivel');
      assert.ok(msg.includes('claude'), 'menciona el adapter rechazado');
      assert.ok(msg.includes('ollama'), 'lista los permitidos');
      assert.ok(msg.includes('karajan.config.json'), 'dice cómo corregirlo');
      return true;
    },
  );
});

test('enforceEasyAdapterPolicy: default no permitido → primer permitido con aviso', () => {
  /** @type {string[]} */
  const logs = [];
  const resolved = enforceEasyAdapterPolicy({
    sensitivity: 'internal',
    adapter: 'claude',
    explicit: false,
    log: (msg) => logs.push(msg),
  });
  assert.equal(resolved, 'ollama');
  assert.ok(logs.some((l) => l.includes('claude') && l.includes('ollama')));
});

test('enforceEasyAdapterPolicy: respeta una policy custom', () => {
  const policy = {
    public: ['mi-llm'],
    internal: ['mi-llm'],
    confidential: ['mi-llm'],
  };
  assert.equal(
    enforceEasyAdapterPolicy({ sensitivity: 'confidential', adapter: 'mi-llm', explicit: true, policy }),
    'mi-llm',
  );
});

test('parseQueryArgs distingue adapter explícito de default/config', () => {
  assert.equal(parseQueryArgs(['q', '--adapter', 'claude']).adapterExplicit, true);
  assert.equal(parseQueryArgs(['q']).adapterExplicit, false);
  assert.equal(parseQueryArgs(['q'], { adapter: 'gemini' }).adapterExplicit, false);
});

test('parseEvalArgs: --sensitivity con default seguro y validación', () => {
  assert.equal(parseEvalArgs(['g.json']).sensitivity, 'internal');
  assert.equal(parseEvalArgs(['g.json', '--sensitivity', 'public']).sensitivity, 'public');
  assert.throws(() => parseEvalArgs(['g.json', '--sensitivity', 'secreto']), /--sensitivity/);
});

test('generateAnswerForHits: hit confidential bloquea un adapter público explícito', async () => {
  const hits = [
    { id: 'a', content: 'dato público', source: 'a.md', score: 0.9, sensitivity: 'public' },
    { id: 'b', content: 'dato reservado', source: 'b.md', score: 0.8, sensitivity: 'confidential' },
  ];
  await assert.rejects(
    () =>
      generateAnswerForHits({
        question: '¿qué dice b?',
        hits: /** @type {never} */ (hits),
        adapter: 'claude',
        adapterExplicit: true,
      }),
    /confidential/,
  );
});

test('generateAnswerForHits: default no permitido se enruta al permitido y redacta PII', async () => {
  /** @type {string[]} */
  const prompts = [];
  const registry = {
    has: (/** @type {string} */ name) => name === 'ollama',
    get: () => async (/** @type {string} */ prompt) => {
      prompts.push(prompt);
      return { parsedOutput: { text: 'respuesta local' } };
    },
  };
  const hits = [
    {
      id: 'a',
      content: 'El email del cliente es cliente@empresa.com.',
      source: 'a.md',
      score: 0.9,
      sensitivity: 'internal',
    },
  ];
  const result = await generateAnswerForHits({
    question: '¿cuál es el contacto?',
    hits: /** @type {never} */ (hits),
    adapter: 'claude',
    adapterExplicit: false,
    registry,
    log: () => {},
  });
  assert.equal(result.adapter, 'ollama');
  assert.equal(result.sensitivity, 'internal');
  assert.equal(prompts.length, 1);
  assert.ok(!prompts[0].includes('cliente@empresa.com'), 'la PII no sale al LLM');
  assert.ok(prompts[0].includes('[REDACTED_EMAIL]'));
});

test('eval --judges: juez no permitido para el nivel declarado → error accionable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-evalgate-'));
  try {
    await mkdir(path.join(root, 'corpus'), { recursive: true });
    await writeFile(path.join(root, 'corpus', 'doc.md'), '# Doc\nContenido.\n', 'utf8');
    await writeFile(
      path.join(root, 'golden.json'),
      JSON.stringify({
        topK: 1,
        baseline: { answerRelevance: 0 },
        cases: [
          { id: 'c1', question: '¿qué hay?', expectedAnswer: 'Contenido.', relevantSources: ['doc.md'] },
        ],
      }),
      'utf8',
    );

    await assert.rejects(
      () =>
        runEvalCommand([path.join(root, 'golden.json'), '--judges', 'claude'], {
          out: () => {},
          judgeRegistry: { has: () => true, get: () => async () => ({}) },
        }),
      (err) => {
        const msg = /** @type {Error} */ (err).message;
        assert.ok(msg.includes('claude'));
        assert.ok(msg.includes('internal'));
        assert.ok(msg.includes('--sensitivity'), 'dice cómo corregirlo');
        return true;
      },
    );

    // Con el corpus declarado public, el mismo juez pasa.
    const report = await runEvalCommand(
      [path.join(root, 'golden.json'), '--judges', 'claude', '--sensitivity', 'public'],
      {
        out: () => {},
        judgeRegistry: {
          has: () => true,
          get: () => async () => ({ parsedOutput: { json: { score: 1, rationale: 'ok' } } }),
        },
      },
    );
    assert.ok('judgeReports' in report);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
