// KJC-TSK-1406 (ADR 0046): the stage director turns stream events into cues
// for the pieces, and groups a burst so the stage stays readable.
import { describe, expect, it } from 'vitest';

import { cueFor, cueLevel, createDirector, CUE_MS } from '../public/stage/director.js';

describe('cueFor', () => {
  it('sends each kj event to its piece, with the tone of its outcome', () => {
    expect(cueFor({ type: 'sentinel-deny', tool: 'Bash' })).toEqual({ piece: 'sentinel', tone: 'refuse', key: 'sentinel-deny' });
    expect(cueFor({ type: 'review-verdict', verdict: 'approved' })).toEqual({ piece: 'review', tone: 'approve', key: 'review-verdict:approved' });
    expect(cueFor({ type: 'review-verdict', verdict: 'rejected' })).toMatchObject({ piece: 'review', tone: 'refuse' });
    expect(cueFor({ type: 'ledger-seal', decision: 'allow' })).toMatchObject({ piece: 'ledger', tone: 'approve' });
    expect(cueFor({ type: 'ledger-seal', decision: 'deny' })).toMatchObject({ piece: 'ledger', tone: 'refuse' });
    expect(cueFor({ type: 'commit-gate', outcome: 'pass' })).toEqual({ piece: 'gates', tone: 'approve', key: 'commit-gate:pass' });
    // KJC-TSK-1524: kj review's checks of TDD, Sonar and the Steward.
    expect(cueFor({ type: 'method-check', piece: 'tdd', outcome: 'pass' })).toEqual({ piece: 'tdd', tone: 'approve', key: 'method-check:tdd:pass' });
    expect(cueFor({ type: 'method-check', piece: 'steward', outcome: 'refuse' })).toMatchObject({ piece: 'steward', tone: 'refuse' });
    expect(cueFor({ type: 'method-check', piece: 'oracle', outcome: 'pass' })).toBeNull();
    expect(cueFor({ type: 'commit-gate', outcome: 'refuse' })).toMatchObject({ piece: 'gates', tone: 'refuse' });
  });

  it('ignores what the stage does not draw', () => {
    expect(cueFor({ type: 'plan', planId: 'p' })).toBeNull();
    expect(cueFor(null)).toBeNull();
  });
});

describe('createDirector', () => {
  it('groups a burst of the same event into one cue with its count', () => {
    const director = createDirector();
    for (let i = 0; i < 50; i++) director.push({ type: 'sentinel-deny', tool: 'Bash' }, 1000 + i);
    director.push({ type: 'review-verdict', verdict: 'approved' }, 1020);
    const cues = director.active(1100);
    expect(cues.map((c) => [c.piece, c.count])).toEqual([['sentinel', 50], ['review', 1]]);
  });

  it('starts a new cue once the previous one of that kind has ended', () => {
    const director = createDirector();
    director.push({ type: 'sentinel-deny' }, 0);
    director.push({ type: 'sentinel-deny' }, CUE_MS + 10);
    expect(director.active(CUE_MS + 20)).toHaveLength(1);
    expect(director.active(CUE_MS + 20)[0]).toMatchObject({ count: 1, at: CUE_MS + 10 });
  });

  it('drops ended cues and ignores events it does not draw', () => {
    const director = createDirector();
    director.push({ type: 'story', storyId: 's' }, 0);
    director.push({ type: 'ledger-seal', decision: 'allow' }, 0);
    expect(director.active(10)).toHaveLength(1);
    expect(director.active(CUE_MS + 1)).toEqual([]);
  });
});

describe('cueLevel', () => {
  it('rises and falls back to rest within the cue duration', () => {
    const cue = { at: 0 };
    expect(cueLevel(cue, 0)).toBe(0);
    expect(cueLevel(cue, CUE_MS / 2)).toBeCloseTo(1);
    expect(cueLevel(cue, CUE_MS)).toBeCloseTo(0);
    expect(cueLevel(cue, CUE_MS * 2)).toBe(0);
  });
});
