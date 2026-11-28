// KJC-TSK-1846 (the maintainer, 2026-11-28): "Pinta de karajan solo pueden tener lo que sea gobierno…
// el resto, si son agentes, deben tener su muñeco de agente con el color que corresponda. Solomon
// también". The reviewer (codex or whichever agent) is an agent: it comes to its own seat with its
// agent's robot while it reviews, instead of Karajan's AI review piece going to the desk for it
// (KJC-TSK-1528). Solomon already does so. The piece still stamps a verdict: that is Karajan's gate.
import { describe, expect, it } from 'vitest';

import { BUD_MS, HOST_WALK_MS, spotOf, withActivity, workerAt, workersFrom } from '../public/stage/workers.js';
import { withVisit } from '../public/stage/piece-visit.js';
import { withReviews } from '../public/stage/review-crew.js';

const activity = (role, agent, phase) => ({ type: 'agent-activity', agent, role, phase, lane: 'main' });

describe('the reviewer is an agent', () => {
  it('comes to its own seat with its agent\'s robot while it reviews', () => {
    const [w] = withActivity([], activity('reviewer', 'codex', 'start'), 0);
    expect(w).toMatchObject({ role: 'reviewer', agent: 'codex' });
    expect(workerAt(w, BUD_MS + HOST_WALK_MS)).toMatchObject({ ...spotOf('reviewer'), walking: false });
    expect(spotOf('reviewer').x).not.toBeCloseTo(spotOf('coder').x);
  });

  it('stands at its seat when the stage opens in the middle of a review', () => {
    const [w] = workersFrom([{ agent: 'codex', role: 'reviewer', at: 'x' }], 5000, 'main');
    expect(workerAt(w, 5000)).toMatchObject({ ...spotOf('reviewer'), walking: false });
  });

  it('no longer sends Karajan\'s AI review piece to the desk in its place', () => {
    expect(withVisit({}, activity('reviewer', 'codex', 'start'), 0)).toEqual({});
    expect(withReviews({}, activity('reviewer', 'codex', 'start'), 0)).toEqual({});
  });

  it('lets the piece still stamp a verdict, Karajan\'s gate', () => {
    const visits = withVisit({}, { type: 'review-verdict', lane: 'main', verdict: 'approved' }, 0);
    expect(visits.review).toBeTruthy();
  });

  it('brings Solomon to its own seat as an agent too', () => {
    const [w] = withActivity([], activity('solomon', 'claude', 'start'), 0);
    expect(workerAt(w, BUD_MS + HOST_WALK_MS)).toMatchObject({ ...spotOf('solomon'), walking: false });
  });
});
