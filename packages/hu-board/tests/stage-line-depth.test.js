// KJC-TSK-1842 (#5066, codex): the rows of workshops grow towards the camera, so a factory alone must
// let the drag reach its last row, and its floor must run under it, whatever the number of lanes.
import { describe, expect, it } from 'vitest';

import { DOOR, VIEW_Z, WORKSHOP, hallSpan, workshopAt } from '../public/stage/layout.js';
import { floorFor } from '../public/stage/warehouse.js';

const COUNTS = [1, 4, 12, 13, 24];
const frontOf = (n) => workshopAt(n - 1, n).z + WORKSHOP.depth / 2;

describe('a factory deep in rows of workshops', () => {
  it('lets the drag bring the view to the front of its last row', () => {
    for (const n of COUNTS) expect(VIEW_Z + hallSpan(n).depth / 2).toBeGreaterThanOrEqual(frontOf(n));
  });

  it('lays its floor from behind the door to past its last row', () => {
    for (const n of COUNTS) {
      const { z, depth } = floorFor(n);
      expect(z - depth / 2).toBeLessThanOrEqual(DOOR.z);
      expect(z + depth / 2).toBeGreaterThanOrEqual(frontOf(n) + 2);
    }
  });
});
