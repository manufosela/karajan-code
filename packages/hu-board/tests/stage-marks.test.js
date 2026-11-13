// KJC-TSK-1437 (ADR 0048): what Karajan's roles do shows in the workshop of the lane where it happens.
import { describe, expect, it } from 'vitest';

import { MARK_MS, marksAt, withMark } from '../public/stage/marks.js';

const verdict = (v, lane) => ({ type: 'review-verdict', verdict: v, reviewer: 'codex', lane });
const commit = (outcome, lane) => ({ type: 'commit-gate', outcome, rule: 'header', lane });
const seal = (decision, lane) => ({ type: 'ledger-seal', decision, chokepoint: 'commit', lane });

describe('marks in the lane', () => {
  it('a verdict, a commit at the gates and a seal each leave their mark in their own lane', () => {
    let marks = withMark([], verdict('approved', 'kj-stage'), 0);
    marks = withMark(marks, commit('refuse', 'main'), 10);
    marks = withMark(marks, seal('deny', 'kj-stage'), 20);
    expect(marksAt(marks, 100).map(({ lane, kind, text, tone }) => [lane, kind, text, tone])).toEqual([
      ['kj-stage', 'review', 'approved by codex', 'approve'],
      ['main', 'gates', 'commit refused (header)', 'refuse'],
      ['kj-stage', 'ledger', 'sealed deny at commit', 'refuse'],
    ]);
  });

  it('a mark fades and is gone after its time; a newer one of the same kind in the lane replaces it', () => {
    let marks = withMark([], commit('refuse', 'main'), 0);
    expect(marksAt(marks, MARK_MS / 2)[0].level).toBeGreaterThan(0);
    expect(marksAt(marks, MARK_MS)).toEqual([]);
    marks = withMark(marks, commit('pass', 'main'), 50);
    expect(marksAt(marks, 60).map((m) => m.text)).toEqual(['commit passed']);
  });

  it('TDD, Sonar and the Steward leave what they checked (KJC-TSK-1582)', () => {
    let marks = withMark([], { type: 'method-check', piece: 'tdd', outcome: 'pass', lane: 'a' }, 0);
    marks = withMark(marks, { type: 'method-check', piece: 'sonar', outcome: 'refuse', lane: 'a' }, 1);
    marks = withMark(marks, { type: 'method-check', piece: 'steward', outcome: 'pass', lane: 'a' }, 2);
    expect(marksAt(marks, 10).map(({ kind, text, tone }) => [kind, text, tone])).toEqual([
      ['tdd', 'TDD ✓', 'approve'], ['sonar', 'Sonar ✗', 'refuse'], ['steward', 'Steward ✓', 'approve'],
    ]);
  });

  it('a Sentinel denial says the tool and the short reason, and a burst counts (KJC-TSK-1582)', () => {
    const deny = { type: 'sentinel-deny', tool: 'Bash', why: 'karajan sentinel: cd/pushd en un comando mutador — las rutas posteriores no son verificables', lane: 'a' };
    let marks = withMark([], deny, 0);
    expect(marksAt(marks, 1)[0]).toMatchObject({ kind: 'sentinel', text: '✗ Bash: cd/pushd en un comando mutador', tone: 'stop' });
    marks = withMark(marks, deny, 100);
    marks = withMark(marks, deny, 200);
    expect(marksAt(marks, 201).map((m) => m.text)).toEqual(['✗ Bash: cd/pushd en un comando mutador ×3']);
    const long = withMark([], { type: 'sentinel-deny', tool: 'Edit', why: 'x'.repeat(80), lane: 'a' }, 0);
    expect(marksAt(long, 1)[0].text).toBe(`✗ Edit: ${'x'.repeat(47)}…`);
  });

  it('an exemption and a verdict that decides nothing have their own tone (KJC-TSK-1585)', () => {
    expect(marksAt(withMark([], seal('exempt', 'a'), 0), 1)[0]).toMatchObject({ text: 'sealed exempt at commit', tone: 'exempt' });
    for (const v of ['error', 'unknown', 'broken']) expect(marksAt(withMark([], verdict(v, 'a'), 0), 1)[0].tone).toBe('unsure');
  });

  it('events with no mark change nothing, and a lane missing in the event is the main checkout', () => {
    const marks = withMark([], { type: 'method-check', piece: 'other', outcome: 'pass' }, 0);
    expect(marks).toEqual([]);
    expect(marksAt(withMark([], verdict('rejected'), 0), 1)[0]).toMatchObject({ lane: 'main', tone: 'refuse' });
  });
});
