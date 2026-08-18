// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadEasyConfig,
  saveEasyConfig,
  validateEasyConfig,
  DEFAULT_EASY_CONFIG,
  CONFIG_FILE,
} from '../src/easy/config.js';

test('validateEasyConfig: acepta config válida y defaults ADR-005', () => {
  assert.deepEqual(validateEasyConfig({}), {});
  const full = validateEasyConfig({ ...DEFAULT_EASY_CONFIG });
  assert.equal(full.store, 'lancedb');
  assert.equal(full.embedder, 'hash');
});

test('validateEasyConfig: rechaza claves y valores inválidos', () => {
  assert.throws(() => validateEasyConfig(null), /objeto/);
  assert.throws(() => validateEasyConfig({ tienda: 'x' }), /no reconocida/);
  assert.throws(() => validateEasyConfig({ store: 'redis' }), /easy\.store/);
  assert.throws(() => validateEasyConfig({ embedder: 'openai' }), /easy\.embedder/);
  assert.throws(() => validateEasyConfig({ dimensions: -1 }), /easy\.dimensions/);
  assert.throws(() => validateEasyConfig({ topK: 1.5 }), /easy\.topK/);
  assert.throws(() => validateEasyConfig({ adapter: 42 }), /easy\.adapter/);
});

test('save/loadEasyConfig: round-trip y null si no existe', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-config-'));
  try {
    assert.equal(await loadEasyConfig(root), null);
    await saveEasyConfig(root, { store: 'in-memory', dimensions: 64 });
    const loaded = await loadEasyConfig(root);
    assert.deepEqual(loaded, { store: 'in-memory', dimensions: 64 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loadEasyConfig: config inválida o corrupta falla explícitamente', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-config-'));
  try {
    await writeFile(path.join(root, CONFIG_FILE), '{"easy":{"store":"redis"}}\n', 'utf8');
    await assert.rejects(() => loadEasyConfig(root), /easy\.store/);
    await writeFile(path.join(root, CONFIG_FILE), '{no json', 'utf8');
    await assert.rejects(() => loadEasyConfig(root), /JSON inválido/);
    await writeFile(path.join(root, CONFIG_FILE), '{"otra":1}\n', 'utf8');
    await assert.rejects(() => loadEasyConfig(root), /sección "easy"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
