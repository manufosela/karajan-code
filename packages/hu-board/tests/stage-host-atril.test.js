// KJC-TSK-1610: since HU-4222 kj hu start picks atril's skills for the host when a card starts and
// writes a host start with them, without the session's id (kj does not have it). The host already
// at its desk goes to atril, reads, and comes back; with none there, one walks in through atril; and
// the Sentinel's next start, with the id, is that same host, never a second one.
import { describe, expect, it } from 'vitest';

import { withEvent } from '../public/stage/rest.js';
import { READER, TURN_MS, WALK_MS, spotOf, withActivity, workerAt } from '../public/stage/workers.js';

const sentinel = (at = 'x') => ({ type: 'agent-activity', agent: 'claude', role: 'host', phase: 'start', id: 's1', tool: 'Edit', lane: 'main', at });
const skills = { type: 'agent-activity', agent: 'claude', role: 'host', phase: 'start', skills: ['tdd-first', 'pr-size'], lane: 'main', at: 'x' };

describe('a host given skills when a card starts', () => {
  it('the host at its desk goes to atril, reads one page per skill and comes back; no second host', () => {
    let workers = withActivity([], sentinel(), 0);
    const at = 60_000;
    workers = withActivity(workers, skills, at);
    expect(workers).toHaveLength(1);
    expect(workerAt(workers[0], at - 1)).toMatchObject({ ...spotOf('host'), walking: false });
    expect(workerAt(workers[0], at + WALK_MS / 2)).toMatchObject({ walking: true });
    expect(workerAt(workers[0], at + WALK_MS + TURN_MS)).toMatchObject({ ...READER, reading: true });
    expect(workerAt(workers[0], at + 2 * WALK_MS + 2 * TURN_MS)).toMatchObject({ ...spotOf('host'), walking: false, reading: false });
  });

  it('the lane\'s state keeps one host either way, with its id', () => {
    let state = withEvent({}, sentinel());
    state = withEvent(state, { ...sentinel(), phase: 'end', waits: 'person' });
    state = withEvent(state, skills);
    expect(state.working).toMatchObject([{ id: 's1', skills: ['tdd-first', 'pr-size'] }]);
    expect(state.working[0]).not.toHaveProperty('waiting'); // it is at work again
    let fresh = withEvent({}, skills);
    fresh = withEvent(fresh, sentinel());
    expect(fresh.working).toHaveLength(1);
    expect(fresh.working[0].id).toBe('s1');
  });

  it('with no host there, one walks in through atril; the Sentinel\'s start with the id is that one', () => {
    let workers = withActivity([], skills, 0);
    expect(workers).toHaveLength(1);
    expect(workerAt(workers[0], WALK_MS + TURN_MS)).toMatchObject({ ...READER, reading: true });
    workers = withActivity(workers, sentinel(), 5000);
    expect(workers).toHaveLength(1);
    expect(workers[0]).toMatchObject({ id: 's1', tool: 'Edit' });
  });
});
