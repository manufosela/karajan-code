// KJC-TSK-1437 (ADR 0048): what Karajan's roles do shows in the workshop of the lane where it happens.
import { describe, expect, it } from 'vitest';

import { MARK_MS, MAX_QUEUED, marksAt, withMark } from '../public/stage/marks.js';

const verdict = (v, lane) => ({ type: 'review-verdict', verdict: v, reviewer: 'codex', lane });
const commit = (outcome, lane) => ({ type: 'commit-gate', outcome, rule: 'header', lane });
const seal = (decision, lane) => ({ type: 'ledger-seal', decision, chokepoint: 'commit', lane });
/** What shows at `now`, as [lane, kind, text, tone]. */
const shown = (marks, now) => marksAt(marks, now).map(({ lane, kind, text, tone }) => [lane, kind, text, tone]);

describe('marks in the lane', () => {
  it('a verdict, a commit at the gates and a seal each leave their mark in their own lane, one at a time (KJC-TSK-1711)', () => {
    let marks = withMark([], verdict('approved', 'kj-stage'), 0);
    marks = withMark(marks, commit('refuse', 'main'), 10);
    marks = withMark(marks, seal('deny', 'kj-stage'), 20);
    expect(shown(marks, 100)).toEqual([['kj-stage', 'review', 'approved by codex', 'approve']]);
    expect(shown(marks, MARK_MS + 1)).toEqual([['main', 'gates', 'commit refused (header)', 'refuse']]);
    expect(shown(marks, 2 * MARK_MS + 1)).toEqual([['kj-stage', 'ledger', 'sealed deny at commit', 'refuse']]);
    expect(shown(marks, 3 * MARK_MS + 1)).toEqual([]);
  });

  it('a mark holds, fades at its end and is gone after its time; a newer one of the same kind waits its turn', () => {
    let marks = withMark([], commit('refuse', 'main'), 0);
    expect(marksAt(marks, MARK_MS / 2)[0].level).toBe(1);
    expect(marksAt(marks, MARK_MS - 100)[0].level).toBeLessThan(1);
    expect(marksAt(marks, MARK_MS)).toEqual([]);
    marks = withMark(marks, commit('pass', 'main'), MARK_MS + 50);
    expect(marksAt(marks, MARK_MS + 60).map((m) => m.text)).toEqual(['commit passed']);
  });

  it('a newer mark of the same kind in the lane replaces the one still waiting (KJC-TSK-1711)', () => {
    let marks = withMark([], verdict('approved', 'a'), 0);
    marks = withMark(marks, commit('refuse', 'a'), 1);
    marks = withMark(marks, commit('pass', 'a'), 2);
    expect(shown(marks, MARK_MS + 1)).toEqual([['a', 'gates', 'commit passed', 'approve']]);
    expect(shown(marks, 2 * MARK_MS + 1)).toEqual([]);
  });

  it('the queue keeps the newest few, so the bubbles never run far behind (KJC-TSK-1711)', () => {
    let marks = withMark([], verdict('approved', 'x'), 0);
    for (let i = 0; i < MAX_QUEUED + 2; i += 1) marks = withMark(marks, verdict('approved', `l${i}`), 1 + i);
    expect(marks).toHaveLength(MAX_QUEUED + 1);
    expect(shown(marks, MARK_MS + 1)[0][0]).toBe('l2');
  });

  it('TDD, Sonar and the Steward leave what they checked (KJC-TSK-1582)', () => {
    let marks = withMark([], { type: 'method-check', piece: 'tdd', outcome: 'pass', lane: 'a' }, 0);
    marks = withMark(marks, { type: 'method-check', piece: 'sonar', outcome: 'refuse', lane: 'a' }, 1);
    marks = withMark(marks, { type: 'method-check', piece: 'steward', outcome: 'pass', lane: 'a' }, 2);
    expect([0, 1, 2].flatMap((i) => shown(marks, i * MARK_MS + 10)).map(([, kind, text, tone]) => [kind, text, tone])).toEqual([
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
    // KJC-BUG-0620: a denial of a session with no robot seen marks no workshop.
    expect(withMark([], { ...deny, lane: undefined, unseen: true }, 0)).toEqual([]);
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
