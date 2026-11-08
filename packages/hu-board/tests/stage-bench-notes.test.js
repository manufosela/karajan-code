// KJC-TSK-1462 (ADR 0050, point 3): a card in progress stays over its lane's bench.
import { describe, expect, it } from 'vitest';

import { NOTE_GAP, benchSpots } from '../public/stage/bench-notes-layout.js';
import { WORKSHOP } from '../public/stage/layout.js';

const xOf = (lane) => ({ main: 0, 'feat-x': 10 })[lane];
const card = (id, lane, status = 'running') => ({ id, lane, status, title: id, at: 'x' });

describe('benchSpots', () => {
  it('puts each card in progress over the bench of its lane', () => {
    expect(benchSpots([card('HU-1', 'feat-x'), card('HU-2', 'main', 'pending'), card('HU-3', 'main', 'done')], xOf, new Set()))
      .toEqual([{ id: 'HU-1', x: 10, z: WORKSHOP.z + 0.4 }]);
  });

  it('lays two cards of one lane side by side, centred on the bench', () => {
    const spots = benchSpots([card('HU-1', 'main'), card('HU-2', 'main')], xOf, new Set());
    expect(spots.map((s) => s.x)).toEqual([-NOTE_GAP / 2, NOTE_GAP / 2]);
  });

  it('a card a robot still carries is not on the bench yet', () => {
    expect(benchSpots([card('HU-1', 'main')], xOf, new Set(['HU-1']))).toEqual([]);
  });
});
