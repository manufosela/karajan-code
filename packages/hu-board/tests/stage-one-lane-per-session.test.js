// KJC-BUG-0581 (the maintainer, 2026-11-13, with a picture): a workshop said "stopped, no agent" while
// a robot typed in it. A session started in lane HU-4235, left that worktree and went on in another
// lane; no end was ever written in HU-4235, so its robot stayed there. A session works in one lane:
// its start in another takes it out of the first, on the floor and in the lane's state.
import { describe, expect, it } from 'vitest';

import { laneStatuses } from '../public/stage/lane-status.js';
import { withEvent } from '../public/stage/rest.js';
import { withActivity, workerAt } from '../public/stage/workers.js';

const start = (lane, id = 'a5af') => ({ type: 'agent-activity', agent: 'claude', role: 'host', phase: 'start', id, lane, at: 'x' });

describe('a session in one lane', () => {
  it('its start in another lane walks its robot out of the first', () => {
    let workers = withActivity([], start('HU-4235'), 0);
    workers = withActivity(workers, start('main'), 10_000);
    const old = workers.find((w) => w.lane === 'HU-4235');
    expect(old.leftAt).toBe(10_000);
    expect(workerAt(old, 60_000)).toBeNull();
    expect(workers.filter((w) => w.leftAt === undefined).map((w) => w.lane)).toEqual(['main']);
  });

  it('and takes it out of the first lane\'s state', () => {
    let state = withEvent({}, start('HU-4235'));
    state = withEvent(state, start('main'));
    expect(state.working.map((w) => w.lane)).toEqual(['main']);
  });

  it('another session keeps its own lane', () => {
    let workers = withActivity([], start('HU-4235', 's1'), 0);
    workers = withActivity(workers, start('main', 's2'), 10);
    expect(workers.every((w) => w.leftAt === undefined)).toBe(true);
  });
});

describe('a lane\'s status and the robots at work', () => {
  it('a robot at work in a lane makes it working, whatever the last state says', () => {
    const statuses = laneStatuses(['HU-4235'], { working: [] }, new Map(), [{ agent: 'claude', role: 'host', lane: 'HU-4235' }]);
    expect(statuses.get('HU-4235').state).toBe('working');
  });
});
