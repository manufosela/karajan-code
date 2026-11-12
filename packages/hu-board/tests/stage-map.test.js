// KJC-TSK-1446 (ADR 0049): the map holds one factory per project of the user, watched by one stream.
import { describe, expect, it } from 'vitest';

import { stageMap, watchMap } from '../src/stage-map.js';

const lanesWith = (working) => [{ lane: 'main', working }];
const dirs = { alpha: '/w/alpha', beta: '/w/beta', demo: '/w/demo' };
const states = { '/w/alpha': lanesWith([]), '/w/beta': lanesWith([{ agent: 'claude', role: 'host' }]), '/w/demo': lanesWith([]) };
const deps = {
  projects: [{ id: 'alpha' }, { id: 'beta' }, { id: 'demo', is_test: 1 }, { id: 'gone' }],
  dirOf: (slug) => dirs[slug] ?? null,
  lanesOf: (dir) => states[dir],
};

describe('stageMap', () => {
  it('is one factory per real project that resolves, the ones at work first', () => {
    // KJC-TSK-1548: with no board cache in their folders, nobody else works on them.
    expect(stageMap(deps)).toEqual([
      { project: 'beta', name: 'beta', lanes: states['/w/beta'] },
      { project: 'alpha', name: 'alpha', lanes: states['/w/alpha'] },
    ]);
  });

  it('puts the teammates\' cards in progress after the own lanes of the same factory (KJC-TSK-1564)', () => {
    const teamOf = (dir) => (dir === '/w/alpha' ? [{ person: 'jorgecasar', at: 't', cards: [{ id: 'HU-3', title: 'three' }] }] : []);
    const alpha = stageMap({ ...deps, teamOf }).find((f) => f.project === 'alpha');
    expect(alpha.lanes.map((l) => l.lane)).toEqual(['main', 'HU-3@jorgecasar']);
  });

  it('names each factory after its folder, not the slug of its whole path (KJC-TSK-1482)', () => {
    const slug = 'home_manu_ws_npm-packages_karajan-code';
    const map = stageMap({ projects: [{ id: slug }], dirOf: () => '/home/manu/ws_npm-packages/karajan-code', lanesOf: () => lanesWith([]) });
    expect(map[0]).toMatchObject({ project: slug, name: 'karajan-code' });
  });

  it('keeps the board order among factories with the same work', () => {
    const idle = { ...deps, lanesOf: () => lanesWith([]) };
    expect(stageMap(idle).map((f) => f.project)).toEqual(['alpha', 'beta']);
  });
});

describe('watchMap', () => {
  it('watches the lanes of every factory, each tagged with its project, and stops them all', () => {
    const watched = [];
    const stopped = [];
    const watchLanes = (dir, send, { project }) => {
      watched.push([dir, project]);
      send({ type: 'x', project });
      return () => stopped.push(project);
    };
    const sent = [];
    const stop = watchMap((e) => sent.push(e), { ...deps, watchLanes });
    expect(watched).toEqual([['/w/alpha', 'alpha'], ['/w/beta', 'beta']]);
    expect(sent).toEqual([{ type: 'x', project: 'alpha' }, { type: 'x', project: 'beta' }]);
    stop();
    expect(stopped).toEqual(['alpha', 'beta']);
  });
});
