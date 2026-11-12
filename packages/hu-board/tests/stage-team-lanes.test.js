// KJC-TSK-1564 (ADR 0056): one repository is one factory. Each card a teammate has in progress is
// a lane of the repository's own factory, named after the card and its owner, not a lot apart.
import { describe, expect, it } from 'vitest';

import { teamLanes } from '../src/stage-team.js';
import { laneStatus, plateName, statusLine } from '../public/stage/lane-status.js';

const team = [
  { person: 'jorgecasar', at: 't', cards: [{ id: 'HU-3', title: 'three', working: true }, { id: 'HU-4', title: 'four', working: false }] },
  { person: 'aitor', at: 't', cards: [] },
];

describe('teamLanes', () => {
  it('makes each card of a teammate a lane of the factory, card@owner', () => {
    expect(teamLanes(team)).toEqual([
      { lane: 'HU-3@jorgecasar', owner: 'jorgecasar', title: 'three', remote: true, remoteWorking: true, working: [] },
      { lane: 'HU-4@jorgecasar', owner: 'jorgecasar', title: 'four', remote: true, remoteWorking: false, working: [] },
    ]);
  });
});

describe('a teammate\'s lane', () => {
  it('works while its owner\'s status says so and says whose it is', () => {
    const status = laneStatus(teamLanes(team)[0]);
    expect(status).toEqual({ state: 'working', why: '@jorgecasar: three', owner: 'jorgecasar' });
    expect(statusLine(status)).toBe('@jorgecasar');
  });

  it('rests otherwise, with its owner and title on the plate; never reads a branch of its own', () => {
    const status = laneStatus(teamLanes(team)[1]);
    expect(status).toEqual({ state: 'idle', why: '@jorgecasar: four', owner: 'jorgecasar' });
    expect(statusLine(status)).toBe('idle: @jorgecasar: four');
  });

  it('shows only the card on its plate; an own lane keeps its whole name', () => {
    expect(plateName('HU-3@jorgecasar')).toBe('HU-3');
    expect(plateName('kj-stage')).toBe('kj-stage');
  });
});
