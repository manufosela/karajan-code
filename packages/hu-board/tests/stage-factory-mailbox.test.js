// KJC-BUG-0578 (the maintainer, 2026-11-13: "now I see no mailbox"): the mailbox was drawn only on the
// map of every factory; a factory opened alone stands it at the front right corner of its hall.
import { describe, expect, it } from 'vitest';

import { LINE } from '../public/stage/line-layout.js';
import { WORKSHOP, mailboxSpot, workshopAt } from '../public/stage/layout.js';

describe('mailboxSpot', () => {
  // KJC-TSK-1842 (the maintainer's sketch, 2026-11-28): at the end of Karajan's row, behind the workshops.
  it('stands in Karajan\'s row, behind the workshops, smaller than on the map', () => {
    for (const n of [1, 4, 9]) {
      const spot = mailboxSpot(n);
      expect(spot.z).toBe(LINE.z);
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
