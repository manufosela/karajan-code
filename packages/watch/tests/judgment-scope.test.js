// @ts-check
// KJW-BUG-0009: el juez razona a veces a nivel de REPO («la app tendrá que
// actualizarse») y el informe colgaba ese razonamiento de un fichero
// concreto — precisión fingida que hace descartar avisos correctos. El
// veredicto declara su alcance y todo el camino lo respeta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeImpact, parseVerdict, buildJudgmentPrompt } from '../src/judgment.js';
import { buildImpactRanking, renderImpactMarkdown } from '../src/report.js';

const policy = { confidential: ['ollama'], internal: ['ollama'], public: ['claude'] };
const candidates = [
  {
    source: 'new-app-android/src/sso/WebClientAuthenticator.kt',
    repo: 'new-app-android',
    score: 0.61,
    evidence: [{ fromChunk: { path: 'src/api.php', newStart: 1 }, line: 4, score: 0.61 }],
  },
];
const coChanges = { byRepo: [], noSignal: [{ repo: 'new-app-ios', reason: 'sin historia' }] };
const params = (affected) => ({
  candidates,
  coChanges,
  diffSummary: 'api: src/api.php',
  sensitivity: 'public',
  policy,
  runAdapter: async () => JSON.stringify({ summary: 'ok', affected }),
});

test('parseVerdict acepta scope repo y da file por defecto', () => {
  const v = parseVerdict(
    JSON.stringify({
      summary: 'ok',
      affected: [
        { source: 'new-app-android', scope: 'repo', severity: 'high', reason: 'parsea la respuesta' },
        { source: 'repo-b/src/x.js', severity: 'low', reason: 'y' },
      ],
    }),
  );
  assert.equal(v.affected[0].scope, 'repo');
  assert.equal(v.affected[1].scope, 'file');
  assert.throws(() => parseVerdict('{"summary":"ok","affected":[{"source":"x","scope":"galaxy","severity":"low","reason":"y"}]}'));
});

test('el prompt ofrece el alcance repo al juez', () => {
  const prompt = buildJudgmentPrompt({ candidates, coChanges, diffSummary: 'x', contracts: [] });
  assert.match(prompt, /"scope"/);
  assert.match(prompt, /repo/i);
});

test('una entrada repo se valida contra los REPOS de las señales, no contra sources', async () => {
  const result = await judgeImpact(
    params([
      { source: 'new-app-android', scope: 'repo', severity: 'high', reason: 'los clientes que parsean esta respuesta deberán actualizarse' },
      { source: 'new-app-ios', scope: 'repo', severity: 'medium', reason: 'ídem — repo con señal de co-cambios vacía pero presente' },
    ]),
  );
  assert.equal(result.verdict.affected.length, 2);
  assert.equal(result.discardedEntries, 0);
});

test('una entrada repo con repo desconocido se descarta con contador, como las de fichero', async () => {
  const result = await judgeImpact(
    params([{ source: 'repo-inventado', scope: 'repo', severity: 'low', reason: 'x' }]),
  );
  assert.equal(result.verdict.affected.length, 0);
  assert.equal(result.discardedEntries, 1);
});

test('el ranking y el render presentan la entrada repo COMO repo, sin fingir fichero', () => {
  const verdict = {
    summary: 'la forma del JSON cambia',
    affected: [
      { source: 'new-app-android', scope: 'repo', severity: 'high', reason: 'los clientes que parsean esta respuesta' },
    ],
  };
  const ranking = buildImpactRanking({ candidates, coChanges, verdict, contracts: [] });
  const repoEntry = ranking.find((e) => e.scope === 'repo');
  assert.ok(repoEntry, 'la entrada repo entra al ranking');
  assert.equal(repoEntry.source, 'new-app-android');
  assert.equal(repoEntry.judged.severity, 'high');
  const md = renderImpactMarkdown({ ranking, diffSummary: 'x' });
  assert.match(md, /repo `new-app-android`/);
  assert.doesNotMatch(md, /repo `new-app-android`\S*\.kt/);
});

test('la entrada repo pesa por severidad: high de repo por delante de un candidato sin juicio', () => {
  const verdict = {
    summary: 'x',
    affected: [{ source: 'new-app-android', scope: 'repo', severity: 'high', reason: 'r' }],
  };
  const ranking = buildImpactRanking({ candidates, coChanges, verdict, contracts: [] });
  assert.equal(ranking[0].scope, 'repo');
});
