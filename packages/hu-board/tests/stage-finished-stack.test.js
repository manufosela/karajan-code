// KJC-TSK-1623 (asked by the maintainer on 2026-11-14; «Pila hasta publicar»): "they say finished
// but the workshops are still there; they should fade, move, stack… and go once done and published".
import { describe, expect, it } from 'vitest';

import { STACK, finishedLanes, stackOf, stackSpot } from '../public/stage/finished-stack.js';
import { RELEASE_TABLE, VERSION_BOARD } from '../public/stage/layout.js';

const statuses = new Map([
  ['main', { state: 'finished', why: 'HU-1 done' }],
  ['HU-2-merged', { state: 'finished', why: 'branch merged' }],
  ['HU-3-working', { state: 'working', why: null }],
  ['HU-4-done', { state: 'finished', why: 'HU-4 done' }],
]);

describe('finishedLanes', () => {
  it('the finished lanes, which leave the row of workshops; never main', () => {
    expect(finishedLanes(statuses)).toEqual(['HU-2-merged', 'HU-4-done']);
  });
});

describe('stackOf', () => {
  const cards = [
    { id: 'HU-4', status: 'done', lane: 'HU-4-done', at: '2026-11-14T10:00:00.000Z' },
    { id: 'HU-5', status: 'done', lane: 'HU-5-old', at: '2026-11-13T10:00:00.000Z' },
    { id: 'HU-6', status: 'done', lane: 'HU-6-new', at: '2026-11-14T11:00:00.000Z' },
  ];
  const lanes = ['HU-4-done', 'HU-5-old', 'HU-6-new', 'HU-2-merged'];

  it('stacks the lanes finished after the last release, the oldest at the bottom, one without a time last', () => {
    expect(stackOf(lanes, cards, { tag: 'v1', at: '2026-11-14T00:00:00.000Z' }).map((b) => b.lane)).toEqual(['HU-4-done', 'HU-6-new', 'HU-2-merged']);
  });

  it('a lane finished before the release is gone; with no release yet, every one stacks', () => {
    expect(stackOf(lanes, cards, { tag: 'v2', at: '2026-11-14T10:30:00.000Z' }).map((b) => b.lane)).toEqual(['HU-6-new', 'HU-2-merged']);
    expect(stackOf(lanes, cards, null)).toHaveLength(4);
  });

  it('each block says its lane\'s HU, from the lane\'s name', () => {
    expect(stackOf(['HU-6-new'], cards, null)[0]).toEqual({ lane: 'HU-6-new', label: 'HU-6', at: '2026-11-14T11:00:00.000Z' });
  });
});

describe('stackSpot', () => {
  it('beside the release table, in columns of blocks one on another, none on the table', () => {
    const first = stackSpot(0);
    expect(first.x).toBeGreaterThan(RELEASE_TABLE.x + 0.8);
    expect(first.y).toBeCloseTo(STACK.size / 2);
    expect(stackSpot(1).y).toBeCloseTo(first.y + STACK.size);
    const next = stackSpot(STACK.high);
    expect(next.y).toBeCloseTo(first.y);
    expect(next.x).toBeGreaterThan(first.x + STACK.size);
  });

  it('clear of the version counter beside the table', () => {
    for (let i = 0; i < 3 * STACK.high; i++) {
      const at = stackSpot(i);
      expect(Math.hypot(at.x - VERSION_BOARD.x, at.z - VERSION_BOARD.z)).toBeGreaterThan(1);
    }
  });
});
