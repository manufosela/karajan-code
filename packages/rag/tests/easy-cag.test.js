// @ts-check
/**
 * KJR-TSK-0142 (épica CAG) — Cache-Augmented Generation: el corpus
 * COMPLETO como contexto, construido de forma determinista desde el
 * manifest, con sensibilidad efectiva = máximo global y presupuesto de
 * tamaño que falla explícito — nunca truncado silencioso.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCagContext, DEFAULT_CAG_MAX_CHARS } from '../src/easy/cag.js';
import { indexDirectory } from '../src/easy/indexer.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';

/** @param {string} root @param {(relPath: string) => import('../src/domain/document.js').Sensitivity} [sensitivityFor] */
async function indexTmpCorpus(root, sensitivityFor) {
  const store = new InMemoryVectorStore({ dimensions: 32 });
  const embedder = createHashEmbedder({ dimensions: 32 });
  await indexDirectory(root, { store, embedder, ...(sensitivityFor ? { sensitivityFor } : {}) });
}

test('buildCagContext: hits por fichero, orden determinista y contenido completo', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cag-'));
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'zeta.md'), '# Zeta\nUltimo alfabeticamente.\n', 'utf8');
    await writeFile(path.join(root, 'src', 'alpha.js'), 'export const alpha = 1;\n', 'utf8');
    await indexTmpCorpus(root);

    const first = await buildCagContext(root);
    const second = await buildCagContext(root);

    assert.equal(first.files.length, 2);
    // Orden por ruta, estable entre ejecuciones (prompt-cache friendly).
    assert.deepEqual(first.hits.map((h) => h.source), ['src/alpha.js', 'zeta.md']);
    assert.deepEqual(first.hits.map((h) => h.source), second.hits.map((h) => h.source));
    assert.equal(first.contextHash, second.contextHash, 'mismo corpus → mismo hash');
    assert.ok(first.hits[0].content.includes('export const alpha = 1;'), 'contenido íntegro');
    assert.ok(first.chars > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildCagContext: sensibilidad efectiva = máximo global del manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cag-sens-'));
  try {
    await mkdir(path.join(root, 'privado'), { recursive: true });
    await writeFile(path.join(root, 'publico.md'), '# Publico\nAbierto.\n', 'utf8');
    await writeFile(path.join(root, 'privado', 'secreto.md'), '# Secreto\nReservado.\n', 'utf8');
    await indexTmpCorpus(root, (relPath) =>
      relPath.startsWith('privado/') ? 'confidential' : 'public');

    const ctx = await buildCagContext(root);
    assert.equal(ctx.sensitivity, 'confidential', 'un solo fichero confidential lo hace todo confidential');
    for (const hit of ctx.hits) {
      assert.ok(['public', 'confidential'].includes(/** @type {string} */ (hit.sensitivity)));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildCagContext: presupuesto excedido → error explícito con tamaño real, nunca truncado', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cag-budget-'));
  try {
    await writeFile(path.join(root, 'grande.md'), `# Grande\n${'contenido '.repeat(200)}\n`, 'utf8');
    await indexTmpCorpus(root);

    await assert.rejects(
      () => buildCagContext(root, { maxChars: 100 }),
      (err) => {
        const msg = /** @type {Error} */ (err).message;
        assert.ok(msg.includes('100'), 'menciona el presupuesto');
        assert.ok(/\d{3,}/.test(msg), 'menciona el tamaño real del corpus');
        assert.ok(msg.includes('--max-context-chars') || msg.includes('rag'), 'ofrece salida accionable');
        return true;
      },
    );
    assert.ok(Number.isInteger(DEFAULT_CAG_MAX_CHARS) && DEFAULT_CAG_MAX_CHARS >= 100_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildCagContext: sin manifest → error accionable que apunta a index', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cag-noindex-'));
  try {
    await assert.rejects(() => buildCagContext(root), /karajan-rag index/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildCagContext: fichero del manifest borrado del disco → error explícito', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cag-missing-'));
  try {
    await writeFile(path.join(root, 'doc.md'), '# Doc\nContenido.\n', 'utf8');
    await indexTmpCorpus(root);
    await rm(path.join(root, 'doc.md'));
    await assert.rejects(() => buildCagContext(root), /doc\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- CLI: query --mode cag (PR 2/2) ---

test('parseQueryArgs: --mode rag|cag con validación y --max-context-chars', async () => {
  const { parseQueryArgs } = await import('../src/easy/cli.js');
  assert.equal(parseQueryArgs(['q']).mode, 'rag');
  const cag = parseQueryArgs(['q', '--answer', '--mode', 'cag', '--max-context-chars', '5000']);
  assert.equal(cag.mode, 'cag');
  assert.equal(cag.maxContextChars, 5000);
  assert.throws(() => parseQueryArgs(['q', '--answer', '--mode', 'turbo']), /--mode/);
  assert.throws(() => parseQueryArgs(['q', '--mode', 'cag']), /--answer/);
  assert.throws(() => parseQueryArgs(['q', '--answer', '--mode', 'cag', '--max-context-chars', '0']), /--max-context-chars/);
});

test('runQueryCommand --mode cag: responde con el corpus completo, sin vector store', async () => {
  const { runQueryCommand } = await import('../src/easy/cli.js');
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cag-cli-'));
  try {
    await writeFile(path.join(root, 'guia.md'), '# Guia\nEl despliegue usa terraform apply.\n', 'utf8');
    await writeFile(path.join(root, 'contacto.md'), 'Soporte: soporte@example.com\n', 'utf8');
    await indexTmpCorpus(root);

    /** @type {string[]} */
    const prompts = [];
    const registry = {
      has: (/** @type {string} */ name) => name === 'ollama',
      get: () => async (/** @type {string} */ prompt) => {
        prompts.push(prompt);
        return { parsedOutput: { text: 'respuesta cag' } };
      },
    };
    /** @type {string[]} */
    const logs = [];
    // Sin --store: el camino cag no abre ningún vector store (no necesita
    // el peer de lancedb) — el manifest basta.
    const result = await runQueryCommand([
      'como se despliega', root, '--answer', '--mode', 'cag',
    ], { adapterRegistry: registry, log: (m) => logs.push(m), out: () => {} });

    assert.equal(result.answer, 'respuesta cag');
    assert.equal(prompts.length, 1);
    assert.ok(prompts[0].includes('terraform apply'), 'el corpus completo viaja en el prompt');
    assert.ok(!prompts[0].includes('soporte@example.com'), 'la PII va redactada');
    assert.ok(logs.some((l) => l.includes('cag') && l.includes('2')), 'log con nº de ficheros');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runQueryCommand --mode cag: presupuesto excedido → error explícito', async () => {
  const { runQueryCommand } = await import('../src/easy/cli.js');
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-cag-cli-budget-'));
  try {
    await writeFile(path.join(root, 'grande.md'), `# G\n${'x '.repeat(300)}\n`, 'utf8');
    await indexTmpCorpus(root);
    await assert.rejects(
      () => runQueryCommand(['q', root, '--answer', '--mode', 'cag', '--max-context-chars', '50'], {
        adapterRegistry: { has: () => true, get: () => async () => ({}) },
        log: () => {}, out: () => {},
      }),
      /--max-context-chars/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
