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

test('corpus: opcional, pero solo admite code y docs', () => {
  const { repos } = minimalConfig();
  const code = { store: 'pgvector', embedder: 'transformers' };
  // Omitir `corpus`, o uno de los dos, ya no es un error: se rellena con los
  // defaults (KJW-TSK-0032). Inventarse una entrada sigue siéndolo.
  assert.doesNotThrow(() => validateConfig({ repos }));
  assert.doesNotThrow(() => validateConfig({ repos, corpus: { code } }));
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

// --- que funcione por defecto (KJW-TSK-0032) -------------------------------
//
// Una instancia debería ser una lista de repos y poco más. Exigir store,
// embedder y sensibilidad de dos corpus obliga a decidir antes de haber
// visto la herramienta funcionar, que es justo cuando peor se decide.

test('config mínimo: solo repos, y arranca por la vía sin servidor', () => {
  const config = validateConfig({ repos: [{ name: 'repo-a' }] });

  assert.equal(config.corpus.code.store, 'lancedb', 'empezar no debe exigir una base de datos');
  assert.equal(config.corpus.code.embedder, 'hash', 'el default no descarga modelos');
  assert.equal(config.corpus.docs.store, 'lancedb');
  assert.equal(config.corpus.code.sensitivity, DEFAULT_SENSITIVITY);
  assert.equal(config.repos[0].branch, 'main');
});

test('corpus a medias: lo declarado manda, el hueco se rellena', () => {
  const config = validateConfig({
    repos: [{ name: 'repo-a' }],
    corpus: { code: { store: 'pgvector' } },
  });

  assert.equal(config.corpus.code.store, 'pgvector', 'lo explícito gana siempre');
  assert.equal(config.corpus.code.embedder, 'hash');
  assert.equal(config.corpus.docs.store, 'lancedb', 'el corpus no declarado también tiene default');
});

test('rellenar huecos NO es tragarse errores', () => {
  // Un valor inválido sigue fallando con su path exacto: la diferencia entre
  // "no lo has dicho" y "lo has dicho mal" es justo lo que no debe perderse.
  assertInvalid({ repos: [{ name: 'r' }], corpus: { code: { store: 'mongo' } } },
    '$.corpus.code.store');
  assertInvalid({ repos: [{ name: 'r' }], corpus: { code: { embedder: 'openai' } } },
    '$.corpus.code.embedder');
  assertInvalid({ repos: [{ name: 'r' }], corpus: { code: { inventado: 1 } } },
    '$.corpus.code.inventado');
  assertInvalid({ repos: [{ name: 'r' }], corpus: { wiki: {} } }, '$.corpus.wiki');
});

test('el config declara qué se ha asumido, para que nadie lo descubra leyendo el código', () => {
  const full = { store: 'pgvector', embedder: 'transformers', sensitivity: 'internal' };
  const explicit = validateConfig({
    repos: [{ name: 'r' }],
    corpus: { code: full, docs: full },
  });
  assert.deepEqual(explicit.defaulted, [], 'sin huecos no hay nada que anunciar');

  const minimal = validateConfig({ repos: [{ name: 'r' }] });
  assert.ok(minimal.defaulted.length > 0);
  assert.ok(
    minimal.defaulted.some((d) => d.includes('$.corpus.code.store') && d.includes('lancedb')),
    'cada valor asumido dice su path y el valor: ' + minimal.defaulted.join(' | '),
  );
});

test('un config ya validado se puede volver a validar', () => {
  // `defaulted` es metadato, no configuración: si se colara como clave del
  // objeto, revalidar —o escribir el config a disco— fallaría por clave
  // desconocida.
  const once = validateConfig({ repos: [{ name: 'r' }] });
  assert.doesNotThrow(() => validateConfig({ ...once }));
  assert.equal(JSON.parse(JSON.stringify(once)).defaulted, undefined);
});
