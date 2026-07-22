// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInitCommand, parseInitArgs, parseIndexArgs, parseQueryArgs } from '../src/easy/cli.js';
import { loadEasyConfig, validateEasyConfig, DEFAULT_EASY_CONFIG } from '../src/easy/config.js';

test('parseInitArgs: defaults y flags', () => {
  const opts = parseInitArgs([]);
  assert.equal(opts.yes, false);
  assert.equal(opts.force, false);
  assert.ok(path.isAbsolute(opts.rootDir));
  const full = parseInitArgs(['./proyecto', '--yes', '--force']);
  assert.equal(full.yes, true);
  assert.equal(full.force, true);
});

test('runInitCommand --yes: genera config con defaults y gitignora .karajan/', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-init-'));
  const logs = [];
  try {
    const easy = await runInitCommand([root, '--yes'], { log: (m) => logs.push(m) });
    assert.deepEqual(easy, { ...DEFAULT_EASY_CONFIG });

    const loaded = await loadEasyConfig(root);
    assert.deepEqual(loaded, { ...DEFAULT_EASY_CONFIG });

    const gitignore = await readFile(path.join(root, '.gitignore'), 'utf8');
    assert.ok(gitignore.includes('.karajan/'));
    assert.ok(logs.some((l) => l.includes('siguiente paso')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runInitCommand: no sobreescribe sin --force y sí con él', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-init-'));
  try {
    await runInitCommand([root, '--yes'], { log: () => {} });
    await assert.rejects(() => runInitCommand([root, '--yes'], { log: () => {} }), /--force/);
    await runInitCommand([root, '--yes', '--force'], { log: () => {} });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runInitCommand interactivo: usa las respuestas del wizard y valida', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-init-'));
  try {
    const answers = { 'vector store': 'in-memory', embedder: 'hash', dimensiones: '64' };
    const easy = await runInitCommand([root], {
      log: () => {},
      ask: async (question, defaultValue) => {
        const match = Object.entries(answers).find(([key]) => question.includes(key));
        return match ? match[1] : defaultValue;
      },
    });
    assert.equal(easy.store, 'in-memory');
    assert.equal(easy.dimensions, 64);

    await assert.rejects(
      () =>
        runInitCommand([root, '--force'], {
          log: () => {},
          ask: async (question, defaultValue) =>
            question.includes('vector store') ? 'redis' : defaultValue,
        }),
      /easy\.store/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('config del proyecto actúa como default y los flags ganan', async () => {
  const config = validateEasyConfig({ store: 'in-memory', embedder: 'hash', dimensions: 64, topK: 9 });
  const idx = parseIndexArgs(['.'], config);
  assert.equal(idx.store, 'in-memory');
  assert.equal(idx.dimensions, 64);
  const idxOverride = parseIndexArgs(['.', '--store', 'lancedb', '--dimensions', '128'], config);
  assert.equal(idxOverride.store, 'lancedb');
  assert.equal(idxOverride.dimensions, 128);

  const q = parseQueryArgs(['pregunta'], validateEasyConfig({ topK: 9, adapter: 'ollama' }));
  assert.equal(q.topK, 9);
  assert.equal(q.adapter, 'ollama');
  const qOverride = parseQueryArgs(['pregunta', '--top-k', '2'], validateEasyConfig({ topK: 9 }));
  assert.equal(qOverride.topK, 2);
});
