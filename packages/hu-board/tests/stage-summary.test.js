// KJC-TSK-1652 (the maintainer, 2026-11-16): "it overloads the browser… if I pick one factory, can it
// load only that one? And the notices come another way: they do not update and I see the amber numbers
// once they are resolved". The projects panel reads a light summary, not the whole map, every 30 s.
import { describe, expect, it } from 'vitest';

import { stageSummary } from '../src/stage-map.js';

const lane = {
  lane: 'main', branch: { ahead: 2 }, pipeline: 'failed', denial: { at: 'x' }, verdict: { at: 'y' }, handoffs: [{ id: 'a', why: 'Seal' }],
  working: [{ agent: 'claude', role: 'host', id: 's1', waiting: 'person', name: 'X' }],
  cards: [{ id: 'HU-1', status: 'running', at: 't', lane: 'main', title: 'secret title' }],
  mail: 1,
};

describe('stageSummary', () => {
  it('is, per project, only what the panel shows: who works (and whether it waits), the cards\' status and the pending notices', () => {
    const deps = { projects: [{ id: 'alpha' }], dirOf: () => '/w/alpha', lanesOf: () => [lane] };
    expect(stageSummary(deps)).toEqual([{
      project: 'alpha', name: 'alpha',
      lanes: [{ lane: 'main', working: [{ waiting: 'person' }], cards: [{ id: 'HU-1', status: 'running', at: 't', lane: 'main' }], mail: 1 }],
    }]);
  });

  it('reads no branch, no pipeline and no teammates: it asks the lanes for their traces alone', () => {
    const asked = [];
    const lanesOf = (dir, options) => { asked.push(options); return [lane]; };
    stageSummary({ projects: [{ id: 'alpha' }], dirOf: () => '/w/alpha', lanesOf, teamOf: () => { throw new Error('no teammates here'); } });
    expect(asked).toHaveLength(1);
    expect(asked[0].branchOf()).toBeNull();
    expect(asked[0].readers).toEqual({});
  });
});
