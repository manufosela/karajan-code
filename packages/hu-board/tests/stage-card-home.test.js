// KJC-TSK-1586: a card sits on the desk of its own lane, not of the lane that moved it.
import { describe, expect, it } from 'vitest';

import { atHome } from '../public/stage/cards.js';
import { benchSpots } from '../public/stage/bench-notes-layout.js';
import { laneStatuses } from '../public/stage/lane-status.js';

const card = (id, lane, status = 'running') => ({ id, lane, status, title: id, at: '2026-11-13T08:00:00.000Z' });
const LANES = ['main', 'HU-4154-release-5-22-0', 'HU-4156-coordinated-release', 'HU-4167-release-participants', 'kj-stage'];

describe('atHome', () => {
  it('takes a card moved from main to the lane its id names', () => {
    expect(atHome([card('HU-4154', 'main')], LANES)).toEqual([card('HU-4154', 'HU-4154-release-5-22-0')]);
  });

  it('takes a card moved from another lane to its own', () => {
    expect(atHome([card('HU-4167', 'HU-4156-coordinated-release')], LANES)[0].lane).toBe('HU-4167-release-participants');
  });

  it('leaves a card without a lane of its own where its line says', () => {
    expect(atHome([card('HU-4080', 'kj-stage')], LANES)[0].lane).toBe('kj-stage');
  });

  it('a card whose lane is gone has no desk', () => {
    expect(atHome([card('HU-3853', 'stage')], LANES)[0].lane).toBeNull();
  });

  it('never takes an id that is only the start of another: HU-41 is not HU-4154', () => {
    expect(atHome([card('HU-41', 'main')], LANES)[0].lane).toBe('main');
  });

  it('a lane named just the id is its home too', () => {
    expect(atHome([card('HU-9', 'main')], ['main', 'HU-9'])[0].lane).toBe('HU-9');
  });
});

describe('benchSpots of a card without a lane', () => {
  it('a card whose lane is gone is on no bench, not on the first one', () => {
    expect(benchSpots(atHome([card('HU-3853', 'stage')], LANES), () => 0, new Set())).toEqual([]);
  });
});

describe('laneStatuses with cards at home', () => {
  it('a lane whose card was moved from main counts that card as its own', () => {
    const lanes = [{ lane: 'HU-4154-release-5-22-0', branch: { upstream: null, gone: false, ahead: 1 } }];
    const status = laneStatuses(['HU-4154-release-5-22-0'], { lanes, cards: [card('HU-4154', 'main')] }, new Map()).get('HU-4154-release-5-22-0');
    expect(status.why).toBe('HU-4154 running, no activity');
  });
});
