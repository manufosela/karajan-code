// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPT_LIMITS, buildJudgmentPrompt } from '../src/judgment.js';

/** Un repo real aporta cientos de paths co-cambiados (KJW-BUG-0004). */
const hugeCoChanges = {
  byRepo: [
    {
      repo: 'repo-b',
      coChanges: Array.from({ length: 400 }, (_, i) => ({
        path: `src/modulo-${String(i).padStart(3, '0')}.js`,
        count: (i % 7) + 1,
        lastDate: '2026-01-10T12:00:00Z',
      })),
    },
  ],
  noSignal: [],
};

const manyCandidates = Array.from({ length: 12 }, (_, i) => ({
  source: `repo-b/src/candidato-${i}.js`,
  repo: 'repo-b',
  score: 0.9 - i * 0.05,
  evidence: Array.from({ length: 20 }, (_, j) => ({
    fromChunk: { path: `src/origen-${j}.js`, newStart: j * 10 },
    line: j,
    score: 0.5,
  })),
}));

test('el prompt queda acotado aunque las señales sean enormes', () => {
  const prompt = buildJudgmentPrompt({
    candidates: manyCandidates,
    coChanges: hugeCoChanges,
    diffSummary: 'repo-a: src/api.js (4 chunks)',
  });
  assert.ok(
    prompt.length < 12000,
    `el prompt debe quedar acotado; midió ${prompt.length} chars`,
  );
});

test('se listan los co-cambios más frecuentes y se dice cuántos quedan fuera', () => {
  const prompt = buildJudgmentPrompt({
    candidates: [],
    coChanges: hugeCoChanges,
    diffSummary: 'x',
  });
  const listed = prompt.split('\n').filter((l) => l.startsWith('- repo-b: src/modulo-'));
  assert.equal(listed.length, PROMPT_LIMITS.coChangesPerRepo);
  // Los que entran son los de mayor frecuencia, no los primeros que llegaron.
  assert.ok(listed.every((l) => /count 7/.test(l)));
  assert.match(prompt, /\+\d+ more co-changes/);
});

test('las evidencias por candidato también se acotan', () => {
  const prompt = buildJudgmentPrompt({
    candidates: manyCandidates.slice(0, 1),
    coChanges: { byRepo: [], noSignal: [] },
    diffSummary: 'x',
  });
  const line = prompt.split('\n').find((l) => l.includes('candidato-0')) ?? '';
  const shown = line.split('src/origen-').length - 1;
  assert.equal(shown, PROMPT_LIMITS.evidencePerCandidate);
  assert.match(line, /\+\d+ more/);
});

test('con señales pequeñas no aparece ninguna nota de omisión', () => {
  const prompt = buildJudgmentPrompt({
    candidates: [
      {
        source: 'repo-b/src/x.js',
        repo: 'repo-b',
        score: 0.8,
        evidence: [{ fromChunk: { path: 'src/a.js', newStart: 1 }, line: 2, score: 0.8 }],
      },
    ],
    coChanges: {
      byRepo: [{ repo: 'repo-b', coChanges: [{ path: 'src/y.js', count: 2, lastDate: '2026-01-10T12:00:00Z' }] }],
      noSignal: [],
    },
    diffSummary: 'x',
  });
  assert.doesNotMatch(prompt, /more co-changes/);
  assert.doesNotMatch(prompt, /\+\d+ more\b/);
});
