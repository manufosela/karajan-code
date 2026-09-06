// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, validateConfig } from '../src/config.js';

/** Config mínima válida sin defaults pendientes (clonar antes de mutar). */
const minimalConfig = () => ({
  repos: [{ name: 'repo-a' }],
  corpus: {
    code: { store: 'pgvector', embedder: 'transformers', sensitivity: 'internal' },
    docs: { store: 'pgvector', embedder: 'transformers', sensitivity: 'internal' },
  },
});

const withRepo = (repo) => ({ ...minimalConfig(), repos: [repo] });

const withDocsRules = (sensitivityRules) => {
  const config = minimalConfig();
  config.corpus.docs.sensitivityRules = sensitivityRules;
  return config;
};

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

test('repos[].group y repos[].dora: se aceptan y se tipan', () => {
  const result = validateConfig(
    withRepo({ name: 'repo-a', group: 'plataforma', dora: { service: 'atlas', tier: 'tier-1' } }),
  );
  assert.equal(result.repos[0].group, 'plataforma');
  assert.deepEqual(result.repos[0].dora, { service: 'atlas', tier: 'tier-1' });
});

test('repos[].group y repos[].dora inválidos: ConfigError con path exacto', () => {
  assertInvalid(withRepo({ name: 'repo-a', group: '' }), '$.repos[0].group');
  assertInvalid(withRepo({ name: 'repo-a', dora: 'tier-1' }), '$.repos[0].dora');
  assertInvalid(withRepo({ name: 'repo-a', dora: { tier: 'tier-1' } }), '$.repos[0].dora.service');
  assertInvalid(withRepo({ name: 'repo-a', dora: { service: 'atlas' } }), '$.repos[0].dora.tier');
  assertInvalid(
    withRepo({ name: 'repo-a', dora: { service: 'atlas', tier: 'tier-1', extra: 1 } }),
    '$.repos[0].dora.extra',
  );
});

test('corpus.docs.sensitivityRules: prefijo → nivel, validado y tipado', () => {
  const rules = [
    { prefix: 'docs/public/', level: 'public' },
    { prefix: 'docs/internal/', level: 'confidential' },
  ];
  const result = validateConfig(withDocsRules(rules));
  assert.deepEqual(result.corpus.docs.sensitivityRules, rules);
});

test('sensitivityRules: level fuera del vocabulario es error de carga', () => {
  assertInvalid(
    withDocsRules([{ prefix: 'docs/', level: 'secreto' }]),
    '$.corpus.docs.sensitivityRules[0].level',
  );
});

test('sensitivityRules: forma estricta — array no vacío, prefix no vacío, sin claves extra ni duplicados', () => {
  const path = '$.corpus.docs.sensitivityRules';
  assertInvalid(withDocsRules([]), path);
  assertInvalid(withDocsRules([{ prefix: '', level: 'public' }]), `${path}[0].prefix`);
  assertInvalid(withDocsRules([{ prefix: 'docs/', level: 'public', extra: 1 }]), `${path}[0].extra`);
  const dup = { prefix: 'docs/', level: 'public' };
  assertInvalid(withDocsRules([dup, { ...dup, level: 'confidential' }]), `${path}[1].prefix`);
});

test('sensitivityRules solo existe en el corpus docs: en code es clave desconocida', () => {
  const config = minimalConfig();
  config.corpus.code.sensitivityRules = [{ prefix: 'src/', level: 'public' }];
  assertInvalid(config, '$.corpus.code.sensitivityRules');
});

test('sin las secciones nuevas: comportamiento idéntico, sin defaults nuevos anunciados', () => {
  const result = validateConfig(minimalConfig());
  assert.equal(result.repos[0].group, undefined);
  assert.equal(result.repos[0].dora, undefined);
  assert.equal(result.corpus.docs.sensitivityRules, undefined);
  assert.deepEqual(result.defaulted, []);
});
