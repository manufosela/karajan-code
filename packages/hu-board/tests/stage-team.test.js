// KJC-TSK-1548 (ADR 0054, slice 1): the map draws the factories of the teammates from the agent
// link only. The cards and their holder come from the shared board, which kj hu keeps cached in
// the main checkout: never a file of another machine.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { teamCards, teamOf } from '../src/stage-team.js';
import { stageMap } from '../src/stage-map.js';

const hu = (n, status, claimed_by, title = `card ${n}`) => ({ short_id: `HU-${n}`, title, status, claimed_by });
const hus = [
  hu(1, 'running', 'manufosela'), hu(2, 'done', 'manufosela'),
  hu(3, 'running', 'jorgecasar'), hu(4, 'running', 'jorgecasar'), hu(5, 'done', 'jorgecasar'),
  hu(6, 'running', 'aitor'), hu(7, 'running', null),
];

describe('teamOf', () => {
  it('takes as mine the holder of the cards of my lanes, and gives every other holder their cards in progress', () => {
    expect(teamOf(hus, ['HU-1', 'HU-2'])).toEqual([
      { person: 'aitor', cards: [{ id: 'HU-6', title: 'card 6' }] },
      { person: 'jorgecasar', cards: [{ id: 'HU-3', title: 'card 3' }, { id: 'HU-4', title: 'card 4' }] },
    ]);
  });

  it('skips entries of the cache that are not cards', () => {
    expect(teamOf([null, 7, 'x', { short_id: 9 }, ...hus], ['HU-1']).map((t) => t.person)).toEqual(['aitor', 'jorgecasar']);
  });

  it('is nobody when it cannot tell who I am', () => {
    expect(teamOf(hus, [])).toEqual([]);
    expect(teamOf(hus, ['HU-7'])).toEqual([]);
  });
});

describe('teamCards', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'stage-team-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the shared board cache of the main checkout, with when it was written', () => {
    mkdirSync(join(dir, '.karajan'));
    writeFileSync(join(dir, '.karajan', 'board-cache.json'), JSON.stringify({ hus, updatedAt: '2026-11-12T00:00:00Z', queue: [] }));
    const team = teamCards(dir, ['HU-1']);
    expect(team.map((t) => [t.person, t.cards.length, t.at])).toEqual([['aitor', 1, '2026-11-12T00:00:00Z'], ['jorgecasar', 2, '2026-11-12T00:00:00Z']]);
  });

  it('is nobody without a cache, or with a broken one', () => {
    expect(teamCards(dir, ['HU-1'])).toEqual([]);
    mkdirSync(join(dir, '.karajan'));
    writeFileSync(join(dir, '.karajan', 'board-cache.json'), '{broken');
    expect(teamCards(dir, ['HU-1'])).toEqual([]);
  });
});

describe('stageMap with the team', () => {
  it('gives each factory its teammates, from the cards of its own lanes, as lanes of it (KJC-TSK-1564)', () => {
    const seen = [];
    const map = stageMap({
      projects: [{ id: 'kc' }],
      dirOf: () => '/w/kc',
      lanesOf: () => [{ lane: 'main', working: [], cards: [{ id: 'HU-1' }] }, { lane: 'x', working: [], cards: [{ id: 'HU-2' }] }],
      teamOf: (dir, ids) => { seen.push([dir, ids]); return [{ person: 'jorgecasar', cards: [{ id: 'HU-9', title: 'nine' }], at: 't' }]; },
    });
    expect(seen).toEqual([['/w/kc', ['HU-1', 'HU-2']]]);
    expect(map[0].lanes.map((l) => l.lane)).toEqual(['main', 'x', 'HU-9@jorgecasar']);
  });
});
