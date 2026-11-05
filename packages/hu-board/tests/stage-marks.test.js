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

  it('events with no mark change nothing, and a lane missing in the event is the main checkout', () => {
    const marks = withMark([], { type: 'sentinel-deny' }, 0);
    expect(marks).toEqual([]);
    expect(marksAt(withMark([], verdict('rejected'), 0), 1)[0]).toMatchObject({ lane: 'main', tone: 'refuse' });
  });
});
