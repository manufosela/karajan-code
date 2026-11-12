// KJC-TSK-1549 (ADR 0054, slice 2): the map draws each teammate's factory beside the own one: a
// lot of its own, a workshop per card in progress, the last known state and nothing live.
import { describe, expect, it } from 'vitest';

import { mapLots } from '../public/stage/team-map.js';

const factories = [
  { project: 'kc', name: 'karajan-code', lanes: [{ lane: 'main' }, { lane: 'kj-stage' }],
    team: [{ person: 'jorgecasar', cards: [{ id: 'HU-3', title: 'three' }, { id: 'HU-4', title: 'four' }], at: 't' }] },
  { project: 'gr', name: 'grebla', lanes: [{ lane: 'main' }] },
];

describe('mapLots', () => {
  it('puts each teammate of a factory right after it, with a workshop per card', () => {
    expect(mapLots(factories).map(({ key, own, name, laneNames }) => ({ key, own, name, laneNames }))).toEqual([
      { key: 'kc', own: true, name: 'karajan-code', laneNames: ['main', 'kj-stage'] },
      { key: 'kc@jorgecasar', own: false, name: 'jorgecasar · karajan-code', laneNames: ['HU-3', 'HU-4'] },
      { key: 'gr', own: true, name: 'grebla', laneNames: ['main'] },
    ]);
  });

  it('keeps on a teammate\'s lot its cards and when the board saw them', () => {
    const remote = mapLots(factories)[1];
    expect(remote).toMatchObject({ person: 'jorgecasar', project: 'kc', at: 't', cards: factories[0].team[0].cards });
  });

  it('draws no teammate without cards, nor any from a board that sends no team', () => {
    const quiet = [{ ...factories[0], team: [{ person: 'aitor', cards: [], at: 't' }] }, factories[1]];
    expect(mapLots(quiet).map((l) => l.key)).toEqual(['kc', 'gr']);
  });
});
