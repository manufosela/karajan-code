// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SENSITIVITY } from 'karajan-rag';
import { ConfigError, loadConfig, validateConfig } from '../src/config.js';

/** Config mínima válida reutilizable en los tests (clonar antes de mutar). */
const minimalConfig = () => ({
  repos: [{ name: 'repo-a' }],
  corpus: {
    code: { store: 'pgvector', embedder: 'transformers' },
    docs: { store: 'pgvector', embedder: 'transformers' },
  },
});

/** Afirma que validateConfig lanza ConfigError con el path exacto. */
const assertInvalid = (config, expectedPath) => {
  assert.throws(
    () => validateConfig(config),
    (err) =>
      err instanceof ConfigError &&
      err.path === expectedPath &&
      err.message.includes(expectedPath),
    `esperaba ConfigError en "${expectedPath}"`,
  );
};

test('config mínima válida: aplica defaults explícitos', () => {
  const result = validateConfig(minimalConfig());
  assert.equal(result.repos[0].name, 'repo-a');
  assert.equal(result.repos[0].branch, 'main');
  assert.equal(result.repos[0].sensitivity, DEFAULT_SENSITIVITY);
  assert.equal(result.corpus.code.sensitivity, DEFAULT_SENSITIVITY);
  assert.equal(result.corpus.docs.sensitivity, DEFAULT_SENSITIVITY);
  assert.equal(result.impact, undefined);
  assert.equal(result.notify, undefined);
});

test('config completa válida: conserva todos los valores declarados', () => {
  const config = {
    repos: [
      { name: 'repo-a', branch: 'develop', sensitivity: 'confidential' },
      { name: 'repo-b' },
    ],
    corpus: {
      code: { store: 'pgvector', embedder: 'transformers', sensitivity: 'confidential' },
      docs: { store: 'lancedb', embedder: 'hash', sensitivity: 'public' },
    },
    impact: { thresholds: { minSimilarity: 0.6, maxCandidates: 10 } },
    notify: {
      targets: [{ type: 'pr-comment' }, { type: 'webhook', url: 'https://example.com/hook' }],
    },
  };
  const result = validateConfig(config);
  assert.equal(result.repos[0].branch, 'develop');
  assert.equal(result.repos[0].sensitivity, 'confidential');
  assert.equal(result.corpus.docs.store, 'lancedb');
  assert.equal(result.impact.thresholds.minSimilarity, 0.6);
  assert.equal(result.notify.targets.length, 2);
});

test('config que no es objeto: ConfigError en raíz', () => {
  assertInvalid(null, '$');
  assertInvalid([], '$');
  assertInvalid('texto', '$');
});

test('clave desconocida en la raíz: error con la clave exacta', () => {
  assertInvalid({ ...minimalConfig(), unknownKey: true }, '$.unknownKey');
});

test('repos: requerido, array no vacío de objetos', () => {
  const { corpus } = minimalConfig();
  assertInvalid({ corpus }, '$.repos');
  assertInvalid({ repos: [], corpus }, '$.repos');
  assertInvalid({ repos: ['repo-a'], corpus }, '$.repos[0]');
});

test('repos[i].name: requerido, string no vacío y único', () => {
  const base = minimalConfig();
  assertInvalid({ ...base, repos: [{}] }, '$.repos[0].name');
  assertInvalid({ ...base, repos: [{ name: '' }] }, '$.repos[0].name');
  assertInvalid({ ...base, repos: [{ name: 'a' }, { name: 'a' }] }, '$.repos[1].name');
});

test('repos[i]: clave desconocida y branch/sensitivity inválidos', () => {
  const base = minimalConfig();
  assertInvalid({ ...base, repos: [{ name: 'a', extra: 1 }] }, '$.repos[0].extra');
  assertInvalid({ ...base, repos: [{ name: 'a', branch: '' }] }, '$.repos[0].branch');
  assertInvalid({ ...base, repos: [{ name: 'a', sensitivity: 'secret' }] }, '$.repos[0].sensitivity');
});

test('corpus: requerido con code y docs exactamente', () => {
  const { repos } = minimalConfig();
  const code = { store: 'pgvector', embedder: 'transformers' };
  assertInvalid({ repos }, '$.corpus');
  assertInvalid({ repos, corpus: { code } }, '$.corpus.docs');
  assertInvalid({ repos, corpus: { docs: code } }, '$.corpus.code');
  assertInvalid({ repos, corpus: { code, docs: code, extra: code } }, '$.corpus.extra');
});

test('corpus.*: store y embedder deben ser valores soportados por karajan-rag', () => {
  const config = minimalConfig();
  config.corpus.code.store = 'postgres';
  assertInvalid(config, '$.corpus.code.store');

  const config2 = minimalConfig();
  config2.corpus.docs.embedder = 'openai';
  assertInvalid(config2, '$.corpus.docs.embedder');

  const config3 = minimalConfig();
  config3.corpus.code.sensitivity = 'top-secret';
  assertInvalid(config3, '$.corpus.code.sensitivity');
});

test('impact.thresholds: rangos estrictos', () => {
  const withImpact = (thresholds) => ({ ...minimalConfig(), impact: { thresholds } });
  assertInvalid({ ...minimalConfig(), impact: {} }, '$.impact.thresholds');
  assertInvalid(withImpact({ minSimilarity: 1.5 }), '$.impact.thresholds.minSimilarity');
  assertInvalid(withImpact({ minSimilarity: -0.1 }), '$.impact.thresholds.minSimilarity');
  assertInvalid(withImpact({ maxCandidates: 0 }), '$.impact.thresholds.maxCandidates');
  assertInvalid(withImpact({ maxCandidates: 2.5 }), '$.impact.thresholds.maxCandidates');
  assertInvalid(withImpact({ extra: 1 }), '$.impact.thresholds.extra');
});

test('notify.targets: array no vacío de destinos tipados', () => {
  const withTargets = (targets) => ({ ...minimalConfig(), notify: { targets } });
  assertInvalid({ ...minimalConfig(), notify: {} }, '$.notify.targets');
  assertInvalid(withTargets([]), '$.notify.targets');
  assertInvalid(withTargets([{ type: 'email' }]), '$.notify.targets[0].type');
  assertInvalid(withTargets([{ type: 'webhook' }]), '$.notify.targets[0].url');
  assertInvalid(withTargets([{ type: 'webhook', url: 'http://insecure' }]), '$.notify.targets[0].url');
  assertInvalid(withTargets([{ type: 'pr-comment', url: 'https://x' }]), '$.notify.targets[0].url');
});

test('policy: opcional, validada con el modelo de karajan-rag', () => {
  const withPolicy = {
    ...minimalConfig(),
    policy: {
      confidential: ['ollama'],
      internal: ['ollama', 'azure-openai'],
      public: ['claude'],
    },
  };
  const result = validateConfig(withPolicy);
  assert.deepEqual(result.policy?.internal, ['ollama', 'azure-openai']);

  assert.equal(validateConfig(minimalConfig()).policy, undefined);

  assertInvalid({ ...minimalConfig(), policy: { internal: ['ollama'] } }, '$.policy');
  assertInvalid({ ...minimalConfig(), policy: 'ollama' }, '$.policy');
});

test('loadConfig: carga y valida un fichero JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-config-'));
  const filePath = join(dir, 'karajan-watch.config.json');
  await writeFile(filePath, JSON.stringify(minimalConfig()), 'utf8');
  const result = await loadConfig(filePath);
  assert.equal(result.repos[0].branch, 'main');
});

test('loadConfig: JSON inválido = ConfigError explícito con el fichero', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kjw-config-'));
  const filePath = join(dir, 'roto.json');
  await writeFile(filePath, '{ no es json', 'utf8');
  await assert.rejects(
    () => loadConfig(filePath),
    (err) => err instanceof ConfigError && err.message.includes(filePath),
  );
});

test('loadConfig: fichero inexistente = error, nunca fallback silencioso', async () => {
  await assert.rejects(() => loadConfig('/no/existe/karajan-watch.config.json'));
});
