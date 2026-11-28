// KJC-TSK-1830 (ADR "kj stage en una línea", accepted 2026-11-27): the line ends with the mailbox,
// then the warehouse and its crane, each in its own stretch, after the release table; nothing of
// them stands in the wall's or the release's stretch any more.
import { describe, expect, it } from 'vitest';

import { lineGroups } from '../public/stage/line-layout.js';
import { mailboxSpot } from '../public/stage/layout.js';
import { RACK, rackSpot, rackX } from '../public/stage/warehouse.js';

const COUNTS = [1, 4, 9];
const stretch = (n, id) => lineGroups(n).find((g) => g.id === id);

describe('the end of the line', () => {
  it('stands the mailbox in the middle of its stretch, after the release table', () => {
    for (const n of COUNTS) {
      const { from, to } = stretch(n, 'mailbox');
      expect(mailboxSpot(n).x).toBeCloseTo((from + to) / 2);
      expect(mailboxSpot(n).x).toBeGreaterThan(stretch(n, 'release').to);
    }
  });

  it('stands the warehouse rack, all of it, in the last stretch, after the mailbox', () => {
    for (const n of COUNTS) {
      const { from, to } = stretch(n, 'warehouse');
      expect(rackX(n) - RACK.w / 2).toBeGreaterThanOrEqual(from);
      expect(rackX(n) + RACK.w / 2).toBeLessThanOrEqual(to);
      expect(rackX(n) - RACK.w / 2).toBeGreaterThan(stretch(n, 'mailbox').to);
    }
  });

  it('so the crane takes a stored workshop to a slab in the warehouse\'s stretch', () => {
    for (const n of COUNTS) {
      const { from, to } = stretch(n, 'warehouse');
      for (const i of [0, 5, 6, 13]) {
        expect(rackSpot(i, n).x).toBeGreaterThanOrEqual(from);
        expect(rackSpot(i, n).x).toBeLessThanOrEqual(to);
      }
    }
  });
});
