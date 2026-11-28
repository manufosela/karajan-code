// KJC-TSK-1828 (#5035, codex): with the workshops in one row, a fifth one ran into the warehouse rack
// (fixed for four) and a seventh one past the 80 m floor of a factory seen alone. The rack stands
// right of the last workshop, whatever their number, and the floor reaches from the booth to it.
import { describe, expect, it } from 'vitest';

import { lineGroups } from '../public/stage/line-layout.js';
import { WORKSHOP, workshopAt } from '../public/stage/layout.js';
import { RACK, floorFor, rackSpot, rackX } from '../public/stage/warehouse.js';

const COUNTS = [1, 2, 4, 5, 7, 12];
const lastRight = (n) => workshopAt(n - 1, n).x + WORKSHOP.width / 2;

describe('the end of the line', () => {
  it('stands the rack right of the last workshop, clear of every one, whatever their number', () => {
    for (const n of COUNTS) {
      expect(rackX(n) - RACK.w / 2).toBeGreaterThan(lastRight(n));
      for (let i = 0; i < n; i++) expect(Math.abs(rackX(n) - workshopAt(i, n).x)).toBeGreaterThan(WORKSHOP.width / 2 + RACK.w / 2);
    }
  });

  it('puts every stored slab on that rack', () => {
    for (const n of COUNTS) for (const i of [0, 7, 13]) expect(rackSpot(i, n).x).toBe(rackX(n));
  });

  it('lays a floor from before the booth to past the rack', () => {
    for (const n of COUNTS) {
      const floor = floorFor(n);
      const booth = lineGroups(n).find((g) => g.id === 'booth');
      expect(floor.x - floor.width / 2).toBeLessThanOrEqual(booth.from - 1);
      expect(floor.x + floor.width / 2).toBeGreaterThanOrEqual(rackX(n) + RACK.w / 2 + 1);
    }
  });
});
