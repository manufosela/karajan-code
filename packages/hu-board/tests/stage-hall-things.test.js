// KJC-TSK-1625 (asked by the maintainer on 2026-11-14): "this should be explained when the mouse is
// over each thing: the table's pile, the stack of boxes, the board…".
import { describe, expect, it } from 'vitest';

import { rectOf, thingAt, thingBoxes, thingTip } from '../public/stage/hall-things.js';
import { RELEASE_TABLE, WALL } from '../public/stage/layout.js';

describe('thingBoxes', () => {
  it('the release table, the task wall and, while it has blocks, the stack', () => {
    expect(thingBoxes(0).map((b) => b.id)).toEqual(['release', 'wall']);
    const boxes = thingBoxes(5);
    expect(boxes.map((b) => b.id)).toEqual(['stack', 'release', 'wall']);
    const table = boxes.find((b) => b.id === 'release');
    expect(table.min.x).toBeLessThan(RELEASE_TABLE.x);
    expect(table.max.x).toBeGreaterThan(RELEASE_TABLE.x);
    const wall = boxes.find((b) => b.id === 'wall');
    expect(wall.max.y).toBeCloseTo(WALL.y + WALL.height);
  });

  it('a taller and wider stack as it grows', () => {
    const small = thingBoxes(1)[0];
    const big = thingBoxes(9)[0];
    expect(big.max.x).toBeGreaterThan(small.max.x);
    expect(big.max.y).toBeGreaterThan(small.max.y);
  });
});

describe('thingAt', () => {
  const rects = [{ id: 'stack', rect: rectOf([{ left: 10, top: 10 }, { left: 30, top: 40 }]) }, { id: 'wall', rect: rectOf([{ left: 0, top: 0 }, { left: 100, top: 100 }]) }];

  it('the first thing whose box on screen holds the pointer', () => {
    expect(thingAt({ left: 20, top: 20 }, rects)).toBe('stack');
    expect(thingAt({ left: 80, top: 80 }, rects)).toBe('wall');
    expect(thingAt({ left: 200, top: 80 }, rects)).toBeNull();
  });
});

describe('thingTip', () => {
  const cards = [
    { id: 'HU-1', status: 'done', at: '2026-11-14T10:00:00.000Z' },
    { id: 'HU-2', status: 'done', at: '2026-11-13T10:00:00.000Z' },
    { id: 'HU-3', status: 'running', at: '2026-11-14T10:00:00.000Z' },
    { id: 'HU-4', status: 'pending', at: '2026-11-14T10:00:00.000Z' },
  ];
  const release = { tag: 'v5.23.0', at: '2026-11-14T00:00:00.000Z' };

  it('the table: the cards done since the last release, which the drone takes', () => {
    expect(thingTip('release', { cards, release, stacked: [] })).toEqual([
      'Ready to release', '1 card done since v5.23.0: HU-1', 'The drone takes them when the next release is published.',
    ]);
  });

  it('the stack: the workshops finished, waiting for the release, and how it differs from the table', () => {
    expect(thingTip('stack', { cards, release, stacked: [{ label: 'HU-1' }, { label: 'HU-7' }] })).toEqual([
      'Finished workshops', '2 lanes merged or done, waiting for the release: HU-1, HU-7',
      'One box per lane; the table holds the cards. The release takes both.',
    ]);
  });

  it('the wall: how many cards in each column', () => {
    expect(thingTip('wall', { cards, release, stacked: [] })).toEqual(['Task wall', '1 to do · 1 in progress · 2 done']);
  });
});
