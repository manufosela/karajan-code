// KJC-TSK-1452 (ADR 0049): where each factory stands on the map of every factory.
import { describe, expect, it } from 'vitest';

import { AISLE, LOT, lotOrigin, lotSize, mapSize } from '../public/stage/map-layout.js';
import { hallWidth } from '../public/stage/layout.js';

describe('lotOrigin', () => {
  it('puts a lone factory at the centre of the map', () => {
    expect(lotOrigin(0, 1)).toEqual({ x: 0, z: 0 });
  });

  it('lays the factories in a near-square grid, the first one at the back left', () => {
    const lots = Array.from({ length: 4 }, (_, i) => lotOrigin(i, 4));
    expect(lots).toEqual([
      { x: -LOT.width / 2, z: -LOT.depth / 2 },
      { x: LOT.width / 2, z: -LOT.depth / 2 },
      { x: -LOT.width / 2, z: LOT.depth / 2 },
      { x: LOT.width / 2, z: LOT.depth / 2 },
    ]);
  });

  it('never puts two factories on the same lot', () => {
    const lots = Array.from({ length: 10 }, (_, i) => lotOrigin(i, 10));
    expect(new Set(lots.map(({ x, z }) => `${x},${z}`)).size).toBe(10);
  });

  it('keeps the grid centred, so the camera looks at the middle of the map', () => {
    const lots = Array.from({ length: 9 }, (_, i) => lotOrigin(i, 9));
    expect(lots.reduce((sum, { x }) => sum + x, 0)).toBeCloseTo(0);
    expect(lots.reduce((sum, { z }) => sum + z, 0)).toBeCloseTo(0);
  });
});

describe('lotSize', () => {
  it('fits the widest hall plus an aisle, not the 80 m floor of the single view', () => {
    const lot = lotSize([1, 2]);
    expect(lot.width).toBe(hallWidth(2) + AISLE + 2);
    expect(lot.width).toBeLessThan(30);
    expect(lot).toEqual(lotSize([2]));
  });

  it('grows with the hall that has the most lanes', () => {
    expect(lotSize([1, 12]).width).toBe(hallWidth(12) + AISLE + 2);
  });

  it('places the lots with the size given', () => {
    const lot = { width: 30, depth: 20 };
    expect(lotOrigin(1, 2, lot)).toEqual({ x: 15, z: 0 });
    expect(mapSize(4, lot)).toEqual({ width: 60, depth: 40 });
  });
});

describe('mapSize', () => {
  it('is as wide and deep as its columns and rows of lots', () => {
    expect(mapSize(1)).toEqual({ width: LOT.width, depth: LOT.depth });
    expect(mapSize(5)).toEqual({ width: 3 * LOT.width, depth: 2 * LOT.depth });
  });
});
