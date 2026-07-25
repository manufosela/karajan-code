// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NotifyError,
  buildImpactRanking,
  renderImpactMarkdown,
  deliverNotifications,
} from '../src/report.js';

const candidates = [
  {
    source: 'repo-b/src/consumer.js',
    repo: 'repo-b',
    score: 0.9,
    evidence: [{ fromChunk: { path: 'src/api.js', newStart: 10 }, line: 5, score: 0.9 }],
  },
  {
    source: 'repo-c/src/client.js',
    repo: 'repo-c',
    score: 0.7,
    evidence: [{ fromChunk: { path: 'src/api.js', newStart: 10 }, line: 2, score: 0.7 }],
  },
  {
    source: 'repo-d/src/low.js',
    repo: 'repo-d',
    score: 0.2,
    evidence: [{ fromChunk: { path: 'src/api.js', newStart: 40 }, line: 9, score: 0.2 }],
  },
];

const coChanges = {
  byRepo: [
    {
      repo: 'repo-b',
      coChanges: [{ path: 'src/consumer.js', count: 3, lastDate: '2026-01-10T12:00:00Z' }],
    },
  ],
  noSignal: [{ repo: 'repo-c', reason: 'sin historial git disponible.' }],
};

const verdict = {
  summary: 'El timeout nuevo afecta al consumidor.',
  affected: [
    { source: 'repo-c/src/client.js', severity: 'high', reason: 'reintenta contra el endpoint' },
    { source: 'repo-b/src/consumer.js', severity: 'medium', reason: 'usa el timeout por defecto' },
  ],
};

test('ranking: severidad juzgada manda sobre el score; evidencia completa por entrada', () => {
  const ranking = buildImpactRanking({ candidates, coChanges, verdict });
  assert.deepEqual(
    ranking.map((e) => e.source),
    ['repo-c/src/client.js', 'repo-b/src/consumer.js', 'repo-d/src/low.js'],
  );
  const [first, second, third] = ranking;
  assert.equal(first.judged?.severity, 'high');
  assert.equal(second.coChange?.count, 3);
  assert.equal(third.judged, null);
  assert.equal(third.coChange, null);
  assert.ok(second.evidence.length > 0);
});

test('ranking: thresholds aplicados (minSimilarity filtra, maxCandidates corta)', () => {
  const withMin = buildImpactRanking({
    candidates,
    coChanges,
    verdict,
    thresholds: { minSimilarity: 0.5 },
  });
  assert.ok(withMin.every((e) => e.score >= 0.5));

  const withMax = buildImpactRanking({
    candidates,
    coChanges,
    verdict,
    thresholds: { maxCandidates: 1 },
  });
  assert.equal(withMax.length, 1);
  assert.equal(withMax[0].source, 'repo-c/src/client.js');

  const withZero = buildImpactRanking({
    candidates,
    coChanges,
    verdict,
    thresholds: { maxCandidates: 0 },
  });
  assert.equal(withZero.length, 0);
});

test('markdown: evidencia visible, sin probabilidades, y PII redactada', () => {
  const ranking = buildImpactRanking({ candidates, coChanges, verdict });
  const markdown = renderImpactMarkdown({
    ranking,
    diffSummary: 'repo-a: src/api.js (2 hunks)',
    verdictSummary: 'Contactar con dev@example.com si hay dudas.',
  });
  assert.ok(markdown.includes('repo-c/src/client.js'));
  assert.ok(markdown.includes('score 0.90'));
  assert.ok(markdown.includes('co-cambios: 3'));
  assert.ok(!/probabilidad/i.test(markdown));
  assert.ok(!markdown.includes('dev@example.com'));
  assert.ok(markdown.includes('[REDACTED_EMAIL]'));
});

test('webhook: POST al url con el markdown; 2xx ok', async () => {
  /** @type {{url: string, options: any}[]} */
  const posts = [];
  await deliverNotifications({
    markdown: '## informe',
    targets: [{ type: 'webhook', url: 'https://chat.example.com/hook' }],
    fetchFn: async (url, options) => {
      posts.push({ url, options });
      return { ok: true, status: 200 };
    },
  });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://chat.example.com/hook');
  assert.equal(posts[0].options.method, 'POST');
  assert.ok(posts[0].options.body.includes('informe'));
});

test('pr-comment: usa la API de GitHub con el contexto de la PR', async () => {
  /** @type {{url: string, options: any}[]} */
  const posts = [];
  await deliverNotifications({
    markdown: '## informe',
    targets: [{ type: 'pr-comment' }],
    prContext: { repoSlug: 'org/repo-a', prNumber: 12, token: 'tok' },
    fetchFn: async (url, options) => {
      posts.push({ url, options });
      return { ok: true, status: 201 };
    },
  });
  assert.equal(posts[0].url, 'https://api.github.com/repos/org/repo-a/issues/12/comments');
  assert.ok(posts[0].options.headers.Authorization.includes('tok'));
});

test('pr-comment sin contexto de PR: NotifyError explícito', async () => {
  await assert.rejects(
    () =>
      deliverNotifications({
        markdown: 'x',
        targets: [{ type: 'pr-comment' }],
        fetchFn: async () => ({ ok: true, status: 200 }),
      }),
    (err) => err instanceof NotifyError && err.message.includes('pr-comment'),
  );
});

test('destino caído: se intentan TODOS y los fallos se agregan en NotifyError', async () => {
  /** @type {string[]} */
  const attempted = [];
  await assert.rejects(
    () =>
      deliverNotifications({
        markdown: 'x',
        targets: [
          { type: 'webhook', url: 'https://caido.example.com/hook' },
          { type: 'webhook', url: 'https://vivo.example.com/hook' },
        ],
        fetchFn: async (url) => {
          attempted.push(url);
          return url.includes('caido')
            ? { ok: false, status: 500 }
            : { ok: true, status: 200 };
        },
      }),
    (err) =>
      err instanceof NotifyError &&
      err.message.includes('caido.example.com') &&
      err.message.includes('500'),
  );
  assert.equal(attempted.length, 2);
});

test('webhook caído: el mensaje de error no filtra la URL completa (posible token)', async () => {
  await assert.rejects(
    () =>
      deliverNotifications({
        markdown: 'x',
        targets: [{ type: 'webhook', url: 'https://hooks.example.com/services/SECRETO123' }],
        fetchFn: async () => ({ ok: false, status: 404 }),
      }),
    (err) =>
      err instanceof NotifyError &&
      err.message.includes('hooks.example.com') &&
      !err.message.includes('SECRETO123'),
  );
});

test('sin targets: no-op explícito sin error', async () => {
  const delivered = await deliverNotifications({
    markdown: 'x',
    targets: [],
    fetchFn: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(delivered, 0);
});
