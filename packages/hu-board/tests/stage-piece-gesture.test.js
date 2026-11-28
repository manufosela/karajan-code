// KJC-TSK-1583: a piece of the method at a workshop inspects, and then stamps (approve) or shakes
// its head (refuse); the AI review, as the others, stamps the verdict it goes to (KJC-TSK-1846).
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

  // KJC-TSK-1846: the piece only goes to stamp a verdict; the reviewer is an agent at its seat.
  it('the AI review answers the verdict it goes to stamp', () => {
    const visits = withVisit({}, { type: 'review-verdict', verdict: 'rejected', lane: 'a' }, 0);
    expect(gestureAt(visits.review, arrive + INSPECT_MS + GESTURE_MS / 2)).toEqual({ kind: 'refuse', k: 0.5 });
  });

  it('makes no gesture without a visit', () => {
    expect(gestureAt(undefined, 10)).toBeNull();
  });
});
