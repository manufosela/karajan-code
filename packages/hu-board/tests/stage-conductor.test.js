// KJC-TSK-1490 (decided by the maintainer on 2026-11-09): Karajan conducts when the
// method acts. A verdict, a commit at the gates or a Ledger seal turn it to that lane's
// workshop: it waves its baton when it passes and raises its hand when it does not.
import { describe, expect, it } from 'vitest';

import { BEAT_MS, conductorAt, withBeat } from '../public/stage/conductor.js';
import { CREW } from '../public/stage/layout.js';

const xOf = () => 6;
const zOf = () => 2;
const beat = (event) => withBeat(null, { lane: 'kj-stage', ...event }, 1000);

describe('Karajan conducts (KJC-TSK-1490)', () => {
  it('rests at its post, arms down, until the method acts', () => {
    expect(conductorAt(null, 5000, xOf, zOf)).toEqual({ yaw: CREW.conductor.yaw, L: [0, 0], R: [0, 0] });
  });

  it('takes a verdict, a commit and a seal; nothing else', () => {
    expect(beat({ type: 'review-verdict', verdict: 'approved' })).toMatchObject({ lane: 'kj-stage', at: 1000, passed: true });
    expect(beat({ type: 'commit-gate', outcome: 'refused' })).toMatchObject({ passed: false });
    expect(beat({ type: 'ledger-seal', decision: 'deny' })).toMatchObject({ passed: false });
    expect(withBeat(null, { type: 'agent-activity' }, 1000)).toBeNull();
  });

  it('turns to the lane and waves the baton while a pass lasts, then rests', () => {
    const b = beat({ type: 'commit-gate', outcome: 'pass' });
    // A quarter and three quarters into one stroke of the baton: up, then down.
    const a = conductorAt(b, 1000 + 150, xOf, zOf);
    const c = conductorAt(b, 1000 + 450, xOf, zOf);
    expect(a.yaw).toBeCloseTo(Math.atan2(6 - CREW.conductor.x, 2 - CREW.conductor.z));
    expect(a.R[0]).toBeGreaterThan(1); // the baton arm up
    expect(a.R[1]).not.toBeCloseTo(c.R[1]); // and waving
    expect(conductorAt(b, 1000 + BEAT_MS, xOf, zOf)).toEqual(conductorAt(null, 0, xOf, zOf));
  });

  it('raises its free hand to stop a refusal, the baton down', () => {
    const pose = conductorAt(beat({ type: 'review-verdict', verdict: 'rejected' }), 1000 + BEAT_MS / 2, xOf, zOf);
    expect(pose.L[1]).toBeGreaterThan(1.2);
    expect(pose.R).toEqual([0, 0]);
  });
});
