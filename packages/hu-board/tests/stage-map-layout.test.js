// KJC-TSK-1452 (ADR 0049): where each factory stands on the map of every factory.
import { describe, expect, it } from 'vitest';

import { FLOOR_Z, GAP, ROW_GAP, packLots, repacked } from '../public/stage/map-layout.js';
import { BOOTH, STATIONS, hallDepth, lineReach, postX } from '../public/stage/layout.js';

const DEPTH = FLOOR_Z.front - FLOOR_Z.back;
// KJC-TSK-1488: a floor runs from behind the door to past the front row of its workshops.
const floorMid = ({ z, depth }) => z + FLOOR_Z.back + depth / 2;
const overlap = (a, b) =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(floorMid(a) - floorMid(b)) < (a.depth + b.depth) / 2;

// KJC-BUG-0555: a factory that grew lanes after the map opened spilled over its neighbours.
describe('repacked', () => {
  it('packs nothing again while no factory changed its lanes', () => {
    expect(repacked([2, 3], [2, 3])).toBeNull();
  });

  it('gives a factory that grew a lot of its new size, and no lot covers another', () => {
    const before = packLots([4, 2, 3]).lots;
    const { lots } = repacked([4, 2, 3], [11, 2, 3]);
    expect(lots[0].depth).toBeGreaterThan(before[0].depth); // KJC-TSK-1842: it grows towards the camera
    for (const [i, a] of lots.entries()) for (const b of lots.slice(i + 1)) expect(overlap(a, b)).toBe(false);
  });
});

describe('packLots (KJC-TSK-1467)', () => {
  // KJC-TSK-1827 (#5033, codex): the line reaches past the camera's fit; a lot holds all of it.
  it('gives each factory only its own line plus 1 m a side, not the widest one', () => {
    const { lots } = packLots([12, 1, 2]);
    // KJC-TSK-1842: the lot holds the whole factory, both rows, centred on x 0.
    expect(lots.map(({ width }) => width)).toEqual([2 * lineReach(12) + 2, 2 * lineReach(1) + 2, 2 * lineReach(2) + 2]);
  });

  it('keeps each factory\'s booth and pieces on its own lot, off its neighbour\'s', () => {
    const { lots } = packLots([1, 1, 1, 1]);
    for (const lot of lots) {
      for (const x of [BOOTH.x, ...STATIONS.map(postX)]) expect(Math.abs(x) + 0.5).toBeLessThanOrEqual(lot.width / 2);
    }
  });

  it('puts a lone factory with its floor at the centre of the map', () => {
    const { lots, width, depth } = packLots([1]);
    expect(lots[0].x).toBe(0);
    expect(floorMid(lots[0])).toBeCloseTo(0);
    expect({ width, depth }).toEqual({ width: 2 * lineReach(1) + 2, depth: DEPTH });
  });

  it('leaves only the gap between neighbours of a row, the first at the back left', () => {
    const { lots } = packLots([1, 1, 1, 1]);
    const [a, b] = lots;
    expect(b.x - a.x).toBeCloseTo((a.width + b.width) / 2 + GAP);
    expect(a.z).toBe(b.z);
    const next = packLots([1, 1, 1, 1, 1, 1, 1, 1]).lots;
    const behind = next.find((lot) => lot.z !== next[0].z);
    expect(behind.z - next[0].z).toBeCloseTo(DEPTH + ROW_GAP);
  });

  it('leaves between rows more room than between neighbours, for the name at the back of each floor (KJC-TSK-1482)', () => {
    expect(ROW_GAP).toBeGreaterThanOrEqual(GAP + 4);
  });

  it('packs many factories into a near-square map with no two floors overlapping', () => {
    const counts = [12, 3, 1, 1, 2, 1, 1, 1, 4, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1];
    const { lots, width, depth } = packLots(counts);
    for (const [i, a] of lots.entries()) for (const b of lots.slice(i + 1)) expect(overlap(a, b)).toBe(false);
    expect(width / depth).toBeGreaterThan(0.5);
    expect(width / depth).toBeLessThan(3);
    const area = lots.reduce((sum, { width: w }) => sum + w * (DEPTH + ROW_GAP), 0);
    expect(area / (width * depth)).toBeGreaterThan(0.55); // little empty floor left
  });

  it('keeps the map centred and inside its bounds', () => {
    const { lots, width, depth } = packLots([5, 1, 2, 1, 1, 3, 1]);
    for (const lot of lots) {
      expect(Math.abs(lot.x) + lot.width / 2).toBeLessThanOrEqual(width / 2 + 1e-9);
      expect(Math.abs(floorMid(lot)) + lot.depth / 2).toBeLessThanOrEqual(depth / 2 + 1e-9);
    }
  });

  it('gives a factory of several rows of workshops a floor deep enough for all of them (KJC-TSK-1488)', () => {
    const counts = [25, 1, 3, 9, 1, 2];
    const { lots, width, depth } = packLots(counts);
    expect(lots.map((lot) => lot.depth)).toEqual(counts.map((n) => DEPTH + hallDepth(n)));
    for (const [i, a] of lots.entries()) for (const b of lots.slice(i + 1)) expect(overlap(a, b)).toBe(false);
    for (const lot of lots) {
      expect(Math.abs(lot.x) + lot.width / 2).toBeLessThanOrEqual(width / 2 + 1e-9);
      expect(Math.abs(floorMid(lot)) + lot.depth / 2).toBeLessThanOrEqual(depth / 2 + 1e-9);
    }
  });
});
