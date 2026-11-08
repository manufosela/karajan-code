// KJC-TSK-1452 (ADR 0049): where each factory stands on the map of every factory.
import { describe, expect, it } from 'vitest';

import { LOT, lotOrigin, mapSize } from '../public/stage/map-layout.js';

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

describe('mapSize', () => {
  it('is as wide and deep as its columns and rows of lots', () => {
    expect(mapSize(1)).toEqual({ width: LOT.width, depth: LOT.depth });
    expect(mapSize(5)).toEqual({ width: 3 * LOT.width, depth: 2 * LOT.depth });
  });
});
