// @ts-check
// KJW-TSK-0043: la config también caduca. En una instancia real, 13 de 29
// repos observados llevaban 3 meses sin un merge y nada lo señalaba — la
// mitad de la config era ruido silencioso. Watch lo AVISA (nunca gate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findInactiveRepos } from '../src/inactivity.js';
import { renderImpactMarkdown } from '../src/report.js';
import { validateConfig } from '../src/config.js';

const NOW = '2026-09-05T12:00:00Z';
const history = (name, dates, readable = true) => ({
  name,
  readable,
  commits: dates.map((date, i) => ({ hash: `h${i}`, date, files: ['x'] })),
});

test('separa activos, inactivos sobre umbral y no-legibles — sin acusar a quien no se puede mirar', () => {
  const result = findInactiveRepos({
    repos: [
      history('vivo', ['2026-09-01T10:00:00Z']),
      history('dormido', ['2026-04-01T10:00:00Z', '2026-03-01T10:00:00Z']),
      history('ilegible', [], false),
      history('vacio-legible', []),
    ],
    thresholdDays: 90,
    now: NOW,
  });
  assert.deepEqual(result.inactive.map((r) => r.repo), ['dormido', 'vacio-legible']);
  const dormido = result.inactive[0];
  assert.equal(dormido.lastActivity, '2026-04-01T10:00:00Z');
  assert.ok(dormido.inactiveDays > 150 && dormido.inactiveDays < 160);
  assert.deepEqual(result.unreadable, ['ilegible']);
});

test('bajo el umbral nadie es inactivo', () => {
  const result = findInactiveRepos({
    repos: [history('a', ['2026-08-01T10:00:00Z'])],
    thresholdDays: 90,
    now: NOW,
  });
  assert.equal(result.inactive.length, 0);
});

test('el informe lista los inactivos como aviso que propone, no que decide', () => {
  const md = renderImpactMarkdown({
    ranking: [],
    diffSummary: 'x',
    inactivity: {
      thresholdDays: 90,
      inactive: [{ repo: 'dormido', lastActivity: '2026-04-01T10:00:00Z', inactiveDays: 157 }],
      unreadable: [],
    },
  });
  assert.match(md, /observados inactivos/i);
  assert.match(md, /`dormido`/);
  assert.match(md, /157/);
  assert.match(md, /retira.*o.*confirma|confirma.*o.*retira/i);
});

test('el umbral es configurable vía impact.thresholds.inactivityDays', () => {
  const config = validateConfig({
    repos: [{ name: 'a' }, { name: 'b' }],
    corpus: {
      code: { store: 'in-memory', embedder: 'hash' },
      docs: { store: 'in-memory', embedder: 'hash' },
    },
    impact: { thresholds: { inactivityDays: 30 } },
  });
  assert.equal(config.impact?.thresholds.inactivityDays, 30);
  assert.throws(() => validateConfig({
    repos: [{ name: 'a' }],
    corpus: {
      code: { store: 'in-memory', embedder: 'hash' },
      docs: { store: 'in-memory', embedder: 'hash' },
    },
    impact: { thresholds: { inactivityDays: -1 } },
  }));
});
