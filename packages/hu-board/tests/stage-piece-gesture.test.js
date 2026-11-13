// KJC-TSK-1583: a piece of the method at a workshop inspects, and then stamps (approve) or shakes
// its head (refuse); the AI review inspects until its verdict comes.
import { describe, expect, it } from 'vitest';

import { GESTURE_MS, INSPECT_MS, PIECE_WALK_MS, gestureAt, withVisit } from '../public/stage/piece-visit.js';

const arrive = PIECE_WALK_MS;

describe('gestureAt', () => {
  it('inspects on arrival, then answers with the result, then rests', () => {
    const { tdd } = withVisit({}, { type: 'method-check', piece: 'tdd', outcome: 'pass', lane: 'a' }, 0);
    expect(gestureAt(tdd, arrive - 1)).toBeNull();
    expect(gestureAt(tdd, arrive + 100)).toMatchObject({ kind: 'inspect' });
    expect(gestureAt(tdd, arrive + INSPECT_MS + GESTURE_MS / 2)).toEqual({ kind: 'approve', k: 0.5 });
    expect(gestureAt(tdd, arrive + INSPECT_MS + GESTURE_MS)).toBeNull();
  });

  it('shakes its head for a refusal', () => {
    const { gates } = withVisit({}, { type: 'commit-gate', outcome: 'fail', lane: 'a' }, 0);
    expect(gestureAt(gates, arrive + INSPECT_MS + 10)).toMatchObject({ kind: 'refuse' });
  });

  it('the AI review inspects while it reviews and answers when the verdict comes', () => {
    let visits = withVisit({}, { type: 'agent-activity', role: 'reviewer', agent: 'agy', phase: 'start', lane: 'a' }, 0);
    expect(gestureAt(visits.review, arrive + 5000)).toMatchObject({ kind: 'inspect' });
    visits = withVisit(visits, { type: 'review-verdict', verdict: 'rejected', lane: 'a' }, arrive + 6000);
    expect(gestureAt(visits.review, arrive + 6000 + GESTURE_MS / 2)).toEqual({ kind: 'refuse', k: 0.5 });
  });

  it('makes no gesture without a visit', () => {
    expect(gestureAt(undefined, 10)).toBeNull();
  });
});
