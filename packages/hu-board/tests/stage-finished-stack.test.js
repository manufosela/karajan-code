// KJC-TSK-1623 (asked by the maintainer on 2026-11-14; «Pila hasta publicar»): "they say finished
// but the workshops are still there; they should fade, move, stack… and go once done and published".
import { describe, expect, it } from 'vitest';

import { FOLD_AFTER_MS, STACK, finishedLanes, foldedNow, stackOf, stackSpot } from '../public/stage/finished-stack.js';
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

// KJC-BUG-0633 (the maintainer, 2026-11-17): "blocks that come and go with no change, they just dance…
// they must be lasting changes". A lane whose host steps out between turns is finished for a moment.
describe('foldedNow', () => {
  const none = new Map();

  it('folds what the stage opens on at once', () => {
    expect(foldedNow(new Set(['A']), new Set(), null, 0).fold).toEqual(new Set(['A']));
  });

  it('folds a lane only once it has been finished for a while, so a pause between turns folds nothing', () => {
    let step = foldedNow(new Set(['A']), new Set(), none, 1000);
    expect(step.fold).toEqual(new Set());
    step = foldedNow(new Set(['A']), step.fold, step.since, 1000 + FOLD_AFTER_MS - 1);
    expect(step.fold).toEqual(new Set());
    expect(foldedNow(new Set(['A']), step.fold, step.since, 1000 + FOLD_AFTER_MS).fold).toEqual(new Set(['A']));
  });

  it('starts counting again when the lane works in between, and unfolds one that works at once', () => {
    const working = foldedNow(new Set(), new Set(), foldedNow(new Set(['A']), new Set(), none, 0).since, 30_000);
    expect(foldedNow(new Set(['A']), new Set(), working.since, FOLD_AFTER_MS).fold).toEqual(new Set());
    expect(foldedNow(new Set(), new Set(['A']), new Map([['A', 0]]), 1).fold).toEqual(new Set());
  });
});
