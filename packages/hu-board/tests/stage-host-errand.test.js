// KJC-TSK-1650 (the maintainer, 2026-11-16): "it cannot appear and disappear out of nothing: either it
// comes out of the booth and goes back, or it is the same agent that types, which stops, takes it and
// comes back" → both. A lane's host at work fetches or carries its own card; with none, the courier.
import { describe, expect, it } from 'vitest';

import { WALL } from '../public/stage/layout.js';
import { ERRAND_MS, PIN_MS, WALK_MS, spotOf, withActivity, withErrand, workerAt } from '../public/stage/workers.js';

const host = (id, lane = 'a') => ({ type: 'agent-activity', agent: 'claude', role: 'host', phase: 'start', lane, id });
const coder = (lane = 'a') => ({ type: 'agent-activity', agent: 'codex', role: 'coder', phase: 'start', lane });
const trip = (lane, out) => ({ id: 'HU-1', lane, out, back: !out });
const wall = { x: WALL.x, z: WALL.z + 0.6 };

describe('withErrand', () => {
  it('gives a card\'s errand to the host at work in its lane, and says it took it', () => {
    const workers = withActivity(withActivity([], host('s1'), 0), coder(), 0);
    const { workers: after, taken } = withErrand(workers, trip('a', false), 1000);
    expect(taken).toBe(true);
    expect(after[0].errand).toEqual({ at: 1000, out: false, id: 'HU-1' });
    expect(after[1].errand).toBeUndefined(); // a coder never runs errands
  });

  it('with no host at work in that lane nobody takes it: it is the courier\'s', () => {
    const workers = withActivity(withActivity([], host('s1', 'b'), 0), coder('a'), 0);
    const { workers: after, taken } = withErrand(workers, trip('a', true), 1000);
    expect(taken).toBe(false);
    expect(after).toBe(workers);
  });
});

describe('a host on an errand', () => {
  const [base] = withActivity([], host('s1'), -100_000);
  const spot = spotOf('host', 0, base.slot);

  it('leaves its desk for the wall, takes the card it fetches there, and brings it back to its desk', () => {
    const w = { ...base, errand: { at: 0, out: false, id: 'HU-1' } };
    expect(workerAt(w, WALK_MS / 2)).toMatchObject({ walking: true, holding: false });
    expect(workerAt(w, WALK_MS + PIN_MS / 2)).toMatchObject({ ...wall, walking: false, holding: true, card: 'HU-1' });
    expect(workerAt(w, WALK_MS + PIN_MS + WALK_MS / 2)).toMatchObject({ walking: true, holding: true });
    expect(workerAt(w, ERRAND_MS)).toMatchObject({ ...spot, walking: false });
    expect(workerAt(w, ERRAND_MS).holding).toBeFalsy();
  });

  it('carries the card it pins to the wall and comes back empty-handed', () => {
    const w = { ...base, errand: { at: 0, out: true, id: 'HU-1' } };
    expect(workerAt(w, WALK_MS / 2)).toMatchObject({ walking: true, holding: true });
    expect(workerAt(w, WALK_MS + PIN_MS + WALK_MS / 2)).toMatchObject({ walking: true, holding: false });
    expect(ERRAND_MS).toBe(2 * WALK_MS + PIN_MS);
  });
});
