// KJC-BUG-0578 (the maintainer, 2026-11-13: "now I see no mailbox"): the mailbox was drawn only on the
// map of every factory; a factory opened alone stands it at the front right corner of its hall.
import { describe, expect, it } from 'vitest';

import { WORKSHOP, mailboxSpot, workshopAt } from '../public/stage/layout.js';

describe('mailboxSpot', () => {
  it('stands just right of the rightmost workshop, level with the last row, smaller than on the map', () => {
    for (const n of [1, 4, 9]) {
      const spot = mailboxSpot(n);
      const right = Math.max(...Array.from({ length: n }, (_, i) => workshopAt(i, n).x)) + WORKSHOP.width / 2;
      expect(spot.x).toBeGreaterThan(right);
      expect(spot.x - right).toBeLessThan(2);
      expect(spot.z).toBe(workshopAt(n - 1, n).z);
      expect(spot.scale).toBeLessThan(1);
    }
  });

  it('clear of every workshop', () => {
    for (const n of [1, 4, 9]) {
      const spot = mailboxSpot(n);
      for (let i = 0; i < n; i++) {
        const w = workshopAt(i, n);
        const inside = Math.abs(spot.x - w.x) < WORKSHOP.width / 2 && Math.abs(spot.z - w.z) < WORKSHOP.depth / 2;
        expect(inside).toBe(false);
      }
    }
  });
});
